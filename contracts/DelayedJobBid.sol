// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

/**
 * @title DelayedJobBid
 * @dev This contract allows the queuing of jobs that are executed after a certain delay.
 * @author david@w2d.co
 */
contract DelayedJobBid {
    // Custom error messages
    error BidPeriodOver(bytes32 jobId);
    error BidNotLowest(bytes32 jobId, uint64 bidAmount, uint64 lowestBid);
    error JobAlreadyExecuted(bytes32 jobId);
    error JobExecutionFailed(bytes32 jobId);
    error JobDoesNotExist(bytes32 jobId);
    error JobNotReady(bytes32 jobId, uint32 readyAt);
    error JobTimeoutNotOver(bytes32 jobId, uint64 timeoutAt);
    error NoBidsForJob(bytes32 jobId);
    error NotEnoughCollateral(
        bytes32 jobId,
        uint64 jobBidCollateral,
        uint64 msgValue,
        address currentBidder
    );
    error NotJobLowestBidder(bytes32 jobId);
    error NotOwner();
    error RewardNotEnough();
    error TargetNotContract(address target);
    error TimeoutTooShort();
    struct Job {
        address target;
        address lowestBidder;
        bytes4 signature;
        uint32 delay;
        uint32 createdAt;
        uint32 timeout;
        uint64 maxReward;
        uint64 lowestBid;
        bytes32 data;
        uint64 bidCollateral;
    }

    address constant ZERO_ADDRESS = address(0);
    uint256 public constant MIN_TIMEOUT = 60 * 60; // 1 hour

    address public owner;
    mapping(bytes32 => Job) public jobs;

    event JobQueued(
        bytes32 indexed jobId,
        address indexed target,
        bytes4 signature,
        bytes32 data,
        uint32 delay,
        uint32 createdAt,
        uint64 maxReward,
        uint32 timeout
    );

    event JobExecuted(
        bytes32 indexed jobId,
        address indexed target,
        address indexed lowestBidder,
        uint64 bidAmount,
        uint64 bidCollateral
    );

    event NewBid(
        bytes32 indexed jobId,
        address indexed bidder,
        uint64 bidAmount,
        uint64 bidCollateral
    );

    event JobCancelled(bytes32 indexed jobId, uint64 bidCollateral, uint32 timestamp);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    /**
     * @notice Queues a job to be executed in the future
     * @param target The contract address that will be called
     * @param signature The function signature of the method to call on the target contract
     * @param data The data to be passed to the target function
     * @param delay The delay before the job can be executed
     * @param maxReward the maximum reward available for the job
     * @param timeout the timeout for the job subject to minimum duration of 1 hour
     */
    function queueJob(
        address target,
        bytes4 signature,
        bytes32 data,
        uint32 delay,
        uint64 maxReward,
        uint32 timeout
    ) external payable onlyOwner {
        if (timeout < MIN_TIMEOUT) revert TimeoutTooShort();
        if (!isContract(target)) revert TargetNotContract(target);
        if (msg.value < maxReward) revert RewardNotEnough();

        bytes32 jobId = getJobId(
            target,
            signature,
            data,
            delay,
            uint32(block.timestamp),
            maxReward,
            timeout
        );

        jobs[jobId] = Job({
            target: target,
            signature: signature,
            delay: delay,
            createdAt: uint32(block.timestamp),
            timeout: timeout,
            maxReward: maxReward,
            lowestBid: maxReward,
            lowestBidder: address(0),
            bidCollateral: 0,
            data: data
        });

        emit JobQueued(
            jobId,
            target,
            signature,
            data,
            delay,
            uint32(block.timestamp),
            maxReward,
            timeout
        );
    }

    /**
     * @dev Allows a user to place a bid on a delayed job.
     * @param jobId The ID of the job to bid on.
     * @param bidAmount The amount of the bid in wei.
     * @notice The job must exist, not have been executed, and the bid period must be open.
     */
    function placeBid(bytes32 jobId, uint64 bidAmount) external payable {
        Job storage job = jobs[jobId];
        if (block.timestamp > job.createdAt + job.delay) revert BidPeriodOver(jobId);
        if (bidAmount >= job.lowestBid) revert BidNotLowest(jobId, bidAmount, job.lowestBid);

        uint64 jobBidCollateral = job.maxReward - bidAmount;

        if (msg.value < jobBidCollateral)
            revert NotEnoughCollateral(jobId, jobBidCollateral, uint64(msg.value), msg.sender);

        // refund the curremt lowest bidder with their bid collateral
        if (job.lowestBidder != address(0)) {
            payable(job.lowestBidder).transfer(job.bidCollateral);
        }

        // update the job with the new lowest bid and bidder
        job.lowestBid = uint64(bidAmount);
        job.lowestBidder = payable(msg.sender);
        job.bidCollateral = uint64(msg.value);

        emit NewBid(jobId, msg.sender, bidAmount, job.bidCollateral);
    }

    /**
     * @dev Cancels a delayed job and refunds the bid collateral to the owner.
     * @param jobId The ID of the job to cancel.
     * @notice This function can only be called by the owner of the contract.
     * @notice The job must exist, not have been executed, and the timeout period must be over.
     */
    function cancelJob(bytes32 jobId) external onlyOwner {
        Job storage job = jobs[jobId];
        if (job.createdAt == 0) revert JobDoesNotExist(jobId);
        if (block.timestamp < job.createdAt + job.delay + job.timeout)
            revert JobTimeoutNotOver(jobId, job.createdAt + job.delay + job.timeout);

        payable(owner).transfer(job.bidCollateral);

        // we delete the job
        delete jobs[jobId];

        // but emit an event with info info on forfeited collateral and timestamp of cancellation
        emit JobCancelled(jobId, job.bidCollateral, uint32(block.timestamp));
    }

    /**
     * @notice Executes a queued job
     * @param jobId The unique identifier for the job to be executed
     * @notice Thejob needs to exist, at least one bid have been received, and the bid period must be over
     */
    function execute(bytes32 jobId) public {
        Job storage job = jobs[jobId];
        if (job.createdAt == 0) revert JobDoesNotExist(jobId);
        if (job.lowestBidder == address(0)) revert NoBidsForJob(jobId);
        if (block.timestamp < job.createdAt + job.delay) {
            revert JobNotReady(jobId, job.createdAt + job.delay);
        }
        if (msg.sender != job.lowestBidder) revert NotJobLowestBidder(jobId);

        (bool success, ) = job.target.call(abi.encodePacked(job.signature, abi.encode(job.data)));
        if (!success) revert JobExecutionFailed(jobId);

        // transfer the bid collateral and reward to the lowest bidder
        payable(job.lowestBidder).transfer(job.lowestBid + job.bidCollateral);

        // transfer the remaining reward to the owner
        payable(owner).transfer(job.maxReward - job.lowestBid);

        emit JobExecuted(jobId, job.target, job.lowestBidder, job.lowestBid, job.bidCollateral);
        // delete the job after execution
        delete jobs[jobId];
    }

    /**
     * @dev Checks if an address is a contract
     * @param target The address to check
     * @return true if the address is a contract, false otherwise
     */
    function isContract(address target) internal view returns (bool) {
        return target.code.length > 0;
    }

    /**
     * @notice Calculates the unique jobId for a given job parameters
     * @param target The contract address that will be called
     * @param signature The function signature of the method to call on the target contract
     * @param data The data to be passed to the target function
     * @param delay The delay before the job can be executed
     * @param _createdAt The timestamp when the job is created
     * @param maxReward the maximum reward available for the job
     * @param timeout the timeout for the job subject to minimum duration of 1 hour
     * @return jobId The unique identifier for the job
     */
    function getJobId(
        address target,
        bytes4 signature,
        bytes32 data,
        uint32 delay,
        uint32 _createdAt,
        uint64 maxReward,
        uint32 timeout
    ) public pure returns (bytes32 jobId) {
        return
            keccak256(
                abi.encodePacked(target, signature, data, delay, _createdAt, maxReward, timeout)
            );
    }
}

