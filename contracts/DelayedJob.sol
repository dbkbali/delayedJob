// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

/**
 * @title DelayedJob
 * @dev This contract allows the queuing of jobs that are executed after a certain delay.
 * @author david@w2d.co
 */
contract DelayedJob {
    // Custom error messages
    error NotOwner();
    error TargetNotContract(address target);
    error RewardNotEnough();
    error JobDoesNotExist(bytes32 jobId);
    error JobNotReady(bytes32 jobId, uint256 readyAt);
    error JobAlreadyExecuted(bytes32 jobId);

    error NotJobExecutor(bytes32 jobId);
    error JobExecutionFailed(bytes32 jobId);
    
    struct Job {
        address target;
        bytes4 signature;
        uint32 delay;
        uint32 createdAt;
        uint128 reward;
        address payable executor;
        bytes32 data;
    }

    address public owner;
    mapping(bytes32 => Job) public jobs;

    event JobQueued(
        bytes32 indexed jobId,
        address indexed target,
        bytes4 signature,
        bytes32 data,
        uint32 delay,
        uint32 timestamp,
        uint128 reward,
        address executor
    );

    event JobExecuted(
        bytes32 indexed jobId,
        address indexed target,
        address indexed executor,
        uint128 reward
    );

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
     * @param reward The amount of Ether to be rewarded to the executor
     * @param executor The address allowed to execute the job
     */
    function queueJob(
        address target,
        bytes4 signature,
        bytes32 data,
        uint32 delay,
        uint128 reward,
        address payable executor
    ) external payable onlyOwner {
        if (!isContract(target)) revert TargetNotContract(target);
        if (msg.value < reward) revert RewardNotEnough();
        bytes32 jobId = getJobId(target, signature, data, delay, uint32(block.timestamp), reward, executor);

        jobs[jobId] = Job({
            target: target,
            signature: signature,
            delay: delay,
            createdAt: uint32(block.timestamp),
            reward: reward,
            executor: executor,
            data: data
        });

        emit JobQueued(jobId, target, signature, data, delay, uint32(block.timestamp), reward, executor);
    }

    /**
     * @notice Executes a queued job
     * @param jobId The unique identifier for the job to be executed
     */
    function execute(bytes32 jobId) public {
        Job storage job = jobs[jobId];
        if (job.createdAt == 0) revert JobDoesNotExist(jobId);
        if (block.timestamp < job.createdAt + job.delay) {
            revert JobNotReady(jobId, job.createdAt + job.delay);
        }
        if (msg.sender != job.executor) revert NotJobExecutor(jobId);

        (bool success, ) = job.target.call(
            abi.encodePacked(job.signature, abi.encode(job.data))
        );
        if (!success) revert JobExecutionFailed(jobId);
        payable(msg.sender).transfer(job.reward);

        emit JobExecuted(jobId, job.target, job.executor, job.reward);
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
     * @param reward The amount of Ether to be rewarded to the executor
     * @param executor The address allowed to execute the job
     * @return jobId The unique identifier for the job
     */
    function getJobId(
        address target,
        bytes4 signature,
        bytes32 data,
        uint32 delay,
        uint32 _createdAt,
        uint128 reward,
        address payable executor
    ) public pure returns (bytes32 jobId) {
        return
            keccak256(
                abi.encodePacked(target, signature, data, delay, _createdAt, reward, executor)
            );
    }
}
