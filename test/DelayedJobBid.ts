import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  AddressLike,
  BytesLike,
  ContractTransactionResponse,
  Typed,
} from "ethers";
import { DelayedJobBid, TargetContract } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";


describe("DelayedJobBid", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployDelayedJobBidFixture() {
    // Contracts are deployed using the first signer/account by default
    const [userA, userB, userC] = await ethers.getSigners();

    const targetContract = await ethers.deployContract("TargetContract", [10]);
    const targetContractAddr = await targetContract.getAddress();

    const DelayedJobBid = await ethers.getContractFactory("DelayedJobBid");
    const delayedJobBid = await DelayedJobBid.deploy();

    return {
      targetContract,
      targetContractAddr,
      delayedJobBid,
      userA,
      userB,
      userC,
    };
  }

  // used for submitting bids in tests
  async function placeBid(delayedJobBidInstance: DelayedJobBid, user: HardhatEthersSigner, etherBidAmount: bigint, queuedJobId: BytesLike, maxReward: bigint, sentCollateral: bigint = maxReward - etherBidAmount) {
    const tx = await delayedJobBidInstance
      .connect(user)
      .placeBid(queuedJobId, etherBidAmount, { value: sentCollateral });
    await expect(tx)
      .to.emit(delayedJobBidInstance, "NewBid")
      .withArgs(queuedJobId, user.address, etherBidAmount, sentCollateral);
  }

  describe("Deployment", function () {
    it("Should set owner to userA", async function () {
      const { delayedJobBid, userA } = await loadFixture(
        deployDelayedJobBidFixture,
      );
      expect(await delayedJobBid.owner()).to.equal(userA.address);
    });
  });

  describe("QueueJob", function () {
    describe("Validations", async function () {
      let delayedJobBidInstance: DelayedJobBid & {
        deploymentTransaction(): ContractTransactionResponse;
      };
      // let userA: HardhatEthersSigner;
      let userB: HardhatEthersSigner;
      let deployedTargetContract: AddressLike | Typed;
      let notTargetContract: AddressLike | Typed;
      let signature: BytesLike;
      let data: BytesLike;
      let delay: number;
      let maxReward: bigint;
      let timeout: number;

      beforeEach(async function () {
        const {
          targetContractAddr,
          delayedJobBid: dj,
          userB: b,
        } = await loadFixture(deployDelayedJobBidFixture);
        delayedJobBidInstance = dj;
        userB = b;
        deployedTargetContract = targetContractAddr;
        notTargetContract = userB.address;
        const funcSig = "testDJ(uint256)";
        signature = ethers.dataSlice(
          ethers.keccak256(ethers.toUtf8Bytes(funcSig)),
          0,
          4,
        );
        const abiCoder = new ethers.AbiCoder();
        data = ethers.zeroPadValue(abiCoder.encode(["uint256"], [2004]), 32);
        delay = 60 * 60 * 24;
        maxReward = ethers.parseEther("1");
        timeout = 60 * 60;
      });

      it("should revert if not called by owner", async function () {
        await expect(
          delayedJobBidInstance
            .connect(userB)
            .queueJob(
              deployedTargetContract,
              signature,
              data,
              delay,
              maxReward,
              timeout, { value: maxReward }
            ),
        ).to.be.revertedWithCustomError(delayedJobBidInstance, "NotOwner");
      });

      it("should revert if delay is less than the min timeout", async function () {
        const ownerTimeout = 60 * 60 - 1;
        await expect(
          delayedJobBidInstance.queueJob(
            deployedTargetContract,
            signature,
            data,
            delay,
            maxReward,
            ownerTimeout,
            { value: maxReward}
          ),
        ).to.be.revertedWithCustomError(
          delayedJobBidInstance,
          "TimeoutTooShort",
        );
      });

      it("should revert if target contract does not exist", async function () {
        await expect(
          delayedJobBidInstance.queueJob(
            notTargetContract,
            signature,
            data,
            delay,
            maxReward,
            timeout,
            { value: maxReward }
          ),
        )
          .to.be.revertedWithCustomError(
            delayedJobBidInstance,
            "TargetNotContract",
          )
          .withArgs(notTargetContract);
      });

      it("should revert if reward is not sufficient", async function () {
        expect(
          delayedJobBidInstance.queueJob(
            deployedTargetContract,
            signature,
            data,
            delay,
            maxReward,
            timeout,
            { value: BigInt(maxReward) - BigInt(1) }
          ),
        )
          .to.be.revertedWithCustomError(
            delayedJobBidInstance,
            "RewardNotEnough",
          )
          .withArgs(2, maxReward);
      });

      it("should queue a job with correct parameters", async function () {
        const newTimestamp = (await time.latest()) + 12 * 100;
        await time.setNextBlockTimestamp(newTimestamp);

        const expectedJobId = ethers.solidityPackedKeccak256(
          [
            "address",
            "bytes4",
            "bytes32",
            "uint32",
            "uint32",
            "uint128",
            "uint32",
          ],
          [
            deployedTargetContract,
            signature,
            data,
            delay,
            newTimestamp,
            maxReward,
            timeout,
          ],
        );

        const tx = await delayedJobBidInstance.queueJob(
          deployedTargetContract,
          signature,
          data,
          delay,
          maxReward,
          timeout,
          { value: maxReward }
        );

        const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
        if (!receipt) {
          throw new Error("No receipt");
        }

        await expect(tx)
          .to.emit(delayedJobBidInstance, "JobQueued")
          .withArgs(
            expectedJobId,
            deployedTargetContract,
            signature,
            data,
            delay,
            newTimestamp,
            maxReward,
            timeout,
          );
        // check jobs mapping
        const job = await delayedJobBidInstance.jobs(expectedJobId);
        expect(job.target).to.equal(deployedTargetContract);
        expect(job.signature).to.equal(signature);
        expect(job.data).to.equal(data);
        expect(job.delay).to.equal(delay);
        expect(job.maxReward).to.equal(maxReward);
        expect(job.timeout).to.equal(timeout);
        expect(job.lowestBid).to.equal(maxReward);
        expect(job.lowestBidder).to.equal(ethers.ZeroAddress);
        expect(job.bidCollateral).to.equal(0);
      });
    });
  });

  describe("PlaceBid", function () {
    let delayedJobBidInstance: DelayedJobBid & {
      deploymentTransaction(): ContractTransactionResponse;
    };
    let userB: HardhatEthersSigner;
    let userC: HardhatEthersSigner;
    let deployedTargetAddr: AddressLike | Typed;
    let signature: BytesLike;
    let data: BytesLike;
    let delay: number;
    let timeout: number;
    let maxReward: bigint;
    let timestamp: number;
    let jobId: BytesLike;

    beforeEach(async function () {
      const {
        targetContractAddr,
        delayedJobBid: dj,
        userA: a,
        userB: b,
        userC: c,
      } = await loadFixture(deployDelayedJobBidFixture);
      delayedJobBidInstance = dj;
      userB = b;
      userC = c;
      deployedTargetAddr = targetContractAddr;
      const funcSig = "testDj(uint256)";
      signature = ethers.dataSlice(
        ethers.keccak256(ethers.toUtf8Bytes(funcSig)),
        0,
        4,
      );
      const abiCoder = new ethers.AbiCoder();
      data = ethers.zeroPadValue(abiCoder.encode(["uint256"], [1001]), 32);
      delay = 60 * 60 * 24;
      timeout = 60 * 60;
      maxReward = ethers.parseEther("1");
      timestamp = (await time.latest()) + 12 * 100;
      await time.setNextBlockTimestamp(timestamp);
      // queue a job
      await delayedJobBidInstance.queueJob(
        deployedTargetAddr,
        signature,
        data,
        delay,
        maxReward,
        timeout,
        { value: maxReward}
      );
      // set the jobId so bids can be placed in tests
      jobId = ethers.solidityPackedKeccak256(
        [
          "address",
          "bytes4",
          "bytes32",
          "uint32",
          "uint32",
          "uint128",
          "uint32",
        ],
        [
          deployedTargetAddr,
          signature,
          data,
          delay,
          timestamp,
          maxReward,
          timeout,
        ],
      );
    });

    it("should not allow bids after delay period", async function () {
      const bidAmount = ethers.parseEther("0.5");
      await time.setNextBlockTimestamp(timestamp + delay + 1);
      await expect(
        placeBid(delayedJobBidInstance, userB, bidAmount, jobId, maxReward)
      )
        .to.be.revertedWithCustomError(delayedJobBidInstance, "BidPeriodOver")
        .withArgs(jobId);
    });

    it("should revert if the bid isn't lower than the existing lowest bid", async function () {
      // place an initial bid to set the lowest bid
      const bidAmount = ethers.parseEther("0.5");
      placeBid(delayedJobBidInstance, userB, bidAmount, jobId, maxReward);

      // 2nd bidder places a bid that is higher or the same as the existing lowest bid
      const userCBidAmount = ethers.parseEther("0.5");
      await expect(
        placeBid(delayedJobBidInstance, userC, userCBidAmount, jobId, maxReward)
      )
        .to.be.revertedWithCustomError(delayedJobBidInstance, "BidNotLowest")
        .withArgs(jobId, userCBidAmount, bidAmount);
    });

    it("should accept the 1st bid if it is lower than the maximum reward with required collateral", async function () {
      const bidAmount: bigint = ethers.parseEther("0.4");
      await placeBid(delayedJobBidInstance, userB, bidAmount, jobId, maxReward);
      const expectedCollateral = maxReward - bidAmount;
      const job = await delayedJobBidInstance.jobs(jobId);
      expect(job.lowestBid).to.equal(bidAmount);
      expect(job.lowestBidder).to.equal(userB.address);
      expect(job.bidCollateral).to.equal(expectedCollateral);
    });

    it("should revert the bid if required collateral is not sent", async function () {
      const bidAmount = ethers.parseEther("0.4");
      const requiredCollateral = maxReward - bidAmount;
      const sentCollateral = ethers.parseEther("0.3");
      await time.setNextBlockTimestamp(timestamp + delay - 1);
      await expect(
        placeBid(delayedJobBidInstance, userB, bidAmount, jobId, maxReward, sentCollateral)
      )
        .to.be.revertedWithCustomError(
          delayedJobBidInstance,
          "NotEnoughCollateral",
        )
        .withArgs(jobId, requiredCollateral, sentCollateral, userB.address);
    });

    it("should accept a 2nd lower bid and refund the 1st bidder with their collateral and update job", async function () {
      // place an initial bid to set the lowest bid
      const bidAmount = ethers.parseEther("0.5");
      const expectedCollateral = maxReward - bidAmount;
      await time.setNextBlockTimestamp(timestamp + delay - 2);
      const tx1 = await delayedJobBidInstance
        .connect(userB)
        .placeBid(jobId, bidAmount, { value: expectedCollateral });
      await expect(tx1)
        .to.emit(delayedJobBidInstance, "NewBid")
        .withArgs(jobId, userB.address, bidAmount, expectedCollateral);

      // 2nd bidder places a bid that is lower than the existing lowest bid
      const userBBalanceBefore = await ethers.provider.getBalance(
        userB.address,
      );
      const userCBidAmount = ethers.parseEther("0.4");
      const userCCollateral = maxReward - userCBidAmount;
      await time.setNextBlockTimestamp(timestamp + delay - 1);

      const tx2 = await delayedJobBidInstance
        .connect(userC)
        .placeBid(jobId, userCBidAmount, { value: userCCollateral });

      await expect(tx2)
        .to.emit(delayedJobBidInstance, "NewBid")
        .withArgs(jobId, userC.address, userCBidAmount, userCCollateral);
      const userBBalanceAfter = await ethers.provider.getBalance(userB.address);
      expect(userBBalanceAfter - userBBalanceBefore).to.equal(
        expectedCollateral,
      );
      const job = await delayedJobBidInstance.jobs(jobId);
      expect(job.lowestBid).to.equal(userCBidAmount);
      expect(job.lowestBidder).to.equal(userC.address);
      expect(job.bidCollateral).to.equal(userCCollateral);
    });
  });

  describe("CancelJob", function () {
    let delayedJobBidInstance: DelayedJobBid & {
      deploymentTransaction(): ContractTransactionResponse;
    };
    let userA: HardhatEthersSigner;
    let userB: HardhatEthersSigner;
    let deployedTargetAddr: AddressLike | Typed;
    let signature: BytesLike;
    let data: BytesLike;
    let delay: number;
    let timeout: number;
    let maxReward: bigint;
    let timestamp: number;
    let queuedJobId: BytesLike;
    let lowestBidAmount: bigint;
    let collateralAmount: bigint;

    beforeEach(async function () {
      const {
        targetContractAddr,
        delayedJobBid: dj,
        userA: a,
        userB: b,
      } = await loadFixture(deployDelayedJobBidFixture);
      userA = a;
      userB = b;
      delayedJobBidInstance = dj;
      deployedTargetAddr = targetContractAddr;
      const funcSig = "testDj(uint256)";
      signature = ethers.dataSlice(
        ethers.keccak256(ethers.toUtf8Bytes(funcSig)),
        0,
        4,
      );
      const abiCoder = new ethers.AbiCoder();
      data = ethers.zeroPadValue(abiCoder.encode(["uint256"], [1001]), 32);
      delay = 60 * 60 * 24;
      timeout = 60 * 60;
      maxReward = ethers.parseEther("1");
      timestamp = (await time.latest()) + 12 * 100;
      await time.setNextBlockTimestamp(timestamp);
      // queue a job
      await delayedJobBidInstance.queueJob(
        deployedTargetAddr,
        signature,
        data,
        delay,
        maxReward,
        timeout,
        { value: maxReward }
      );
      // set the jobId so bids can be placed in tests
      queuedJobId = ethers.solidityPackedKeccak256(
        [
          "address",
          "bytes4",
          "bytes32",
          "uint32",
          "uint32",
          "uint128",
          "uint32",
        ],
        [
          deployedTargetAddr,
          signature,
          data,
          delay,
          timestamp,
          maxReward,
          timeout,
        ],
      );

      // place an initial bid to set the lowest bid
      lowestBidAmount = ethers.parseEther("0.6");
      collateralAmount = maxReward - lowestBidAmount;
      await time.setNextBlockTimestamp(timestamp + delay - 1);
      const tx1 = await delayedJobBidInstance
        .connect(userB)
        .placeBid(queuedJobId, lowestBidAmount, { value: collateralAmount });
      await expect(tx1)
        .to.emit(delayedJobBidInstance, "NewBid")
        .withArgs(
          queuedJobId,
          userB.address,
          lowestBidAmount,
          collateralAmount,
        );
    });

    it("should revert if not called by owner", async function () {
      await expect(
        delayedJobBidInstance.connect(userB).cancelJob(queuedJobId),
      ).to.be.revertedWithCustomError(delayedJobBidInstance, "NotOwner");
    });

    it("should revert if job does not exist", async function () {
      const jobId = ethers.keccak256(ethers.randomBytes(32));
      await expect(delayedJobBidInstance.cancelJob(jobId))
        .to.be.revertedWithCustomError(delayedJobBidInstance, "JobDoesNotExist")
        .withArgs(jobId);
    });

    it("should revert if job timeout has not passed", async function () {
      await time.setNextBlockTimestamp(timestamp + delay + timeout - 1);
      await expect(delayedJobBidInstance.cancelJob(queuedJobId))
        .to.be.revertedWithCustomError(
          delayedJobBidInstance,
          "JobTimeoutNotOver",
        )
        .withArgs(queuedJobId, timestamp + delay + timeout);
    });

    it("should cancel the job and pay owner the collateral and the collateral", async function () {
      const ownerBalanceBefore = await ethers.provider.getBalance(
        userA.address,
      );
      await time.setNextBlockTimestamp(timestamp + delay + timeout + 1);
      const tx = await delayedJobBidInstance.cancelJob(queuedJobId);

      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      if (!receipt) {
        throw new Error("No receipt");
      }

      // calculate gas used
      const gasUsed = receipt.gasUsed;

      // get the gas price from the transaction
      const txdetails = await ethers.provider.getTransaction(tx.hash);
      if (!txdetails) {
        throw new Error("No transaction details");
      }
      const gasPrice = txdetails.gasPrice;
      const gasCost = gasUsed * gasPrice;

      expect(tx)
        .to.emit(delayedJobBidInstance, "JobCancelled")
        .withArgs(queuedJobId, userA.address, maxReward);
      const ownerBalanceAfter = await ethers.provider.getBalance(userA.address);
      expect(ownerBalanceAfter - ownerBalanceBefore + gasCost).to.equal(
        collateralAmount,
      );
    });
  });

  describe("Execute", function () {
    describe("Validations", function () {
      let delayedJobBidInstance: DelayedJobBid & {
        deploymentTransaction(): ContractTransactionResponse;
      };
      let userA: HardhatEthersSigner;
      let userB: HardhatEthersSigner;
      let deployedTargetAddr: AddressLike | Typed;
      let deployedTarget: TargetContract;
      let signature: BytesLike;
      let data: BytesLike;
      let delay: number;
      let timeout: number;
      let maxReward: bigint;
      let timestamp: number;
      let queuedJobId: BytesLike;
      let lowestBidAmount: bigint;
      let collateralAmount: bigint;

      beforeEach(async function () {
        const {
          targetContract,
          targetContractAddr,
          delayedJobBid: dj,
          userA: a,
          userB: b,
        } = await loadFixture(deployDelayedJobBidFixture);
        userA = a;
        userB = b;
        delayedJobBidInstance = dj;
        deployedTargetAddr = targetContractAddr;
        deployedTarget = targetContract as TargetContract;
        const funcSig = "testDj(uint256)";
        signature = ethers.dataSlice(
          ethers.keccak256(ethers.toUtf8Bytes(funcSig)),
          0,
          4,
        );
        const abiCoder = new ethers.AbiCoder();
        data = ethers.zeroPadValue(abiCoder.encode(["uint256"], [1001]), 32);
        delay = 60 * 60 * 24;
        timeout = 60 * 60;
        maxReward = ethers.parseEther("1");
        timestamp = (await time.latest()) + 12 * 100;
        await time.setNextBlockTimestamp(timestamp);
        // queue a job
        await delayedJobBidInstance.queueJob(
          deployedTargetAddr,
          signature,
          data,
          delay,
          maxReward,
          timeout,
          { value: maxReward }
        );
        // set the jobId so bids can be placed in tests
        queuedJobId = ethers.solidityPackedKeccak256(
          [
            "address",
            "bytes4",
            "bytes32",
            "uint32",
            "uint32",
            "uint128",
            "uint32",
          ],
          [
            deployedTargetAddr,
            signature,
            data,
            delay,
            timestamp,
            maxReward,
            timeout,
          ],
        );
      });

      it("should revert if job does not exist", async function () {
        const jobId = ethers.keccak256(ethers.randomBytes(32));
        await expect(delayedJobBidInstance.connect(userB).execute(jobId))
          .to.be.revertedWithCustomError(
            delayedJobBidInstance,
            "JobDoesNotExist",
          )
          .withArgs(jobId);
      });

      it("should revert if there are no bids for the job", async function () {
        await time.setNextBlockTimestamp(timestamp + delay + 1);
        await expect(delayedJobBidInstance.connect(userB).execute(queuedJobId))
          .to.be.revertedWithCustomError(delayedJobBidInstance, "NoBidsForJob")
          .withArgs(queuedJobId);
      });

      it("should revert if called before delay", async function () {
        // place a bid to set the lowest bid
        lowestBidAmount = ethers.parseEther("0.6");
        collateralAmount = maxReward - lowestBidAmount;
        await time.setNextBlockTimestamp(timestamp + delay - 2);
        await placeBid(delayedJobBidInstance, userB, lowestBidAmount, queuedJobId, maxReward, collateralAmount);

        await time.setNextBlockTimestamp(timestamp + delay - 1);
        await expect(delayedJobBidInstance.connect(userB).execute(queuedJobId))
          .to.be.revertedWithCustomError(delayedJobBidInstance, "JobNotReady")
          .withArgs(queuedJobId, timestamp + delay);
      });

      it("should revert after delay if not called by lowest bidder", async function () {
        // UserB places the initial bid 
        lowestBidAmount = ethers.parseEther("0.6");
        collateralAmount = maxReward - lowestBidAmount;
        await time.setNextBlockTimestamp(timestamp + delay - 1);
        await placeBid(delayedJobBidInstance, userB, lowestBidAmount, queuedJobId, maxReward, collateralAmount);
        
        // userA tries to execute the job
        await time.setNextBlockTimestamp(timestamp + delay + 1);
        await expect(delayedJobBidInstance.connect(userA).execute(queuedJobId))
          .to.be.revertedWithCustomError(
            delayedJobBidInstance,
            "NotJobLowestBidder",
          )
          .withArgs(queuedJobId);
      });


      it("should execute job if called after delay by lowest bidder", async function () {
        // place a bid to set the lowest bid
        lowestBidAmount = ethers.parseEther("0.6");
        collateralAmount = maxReward - lowestBidAmount;
        await time.setNextBlockTimestamp(timestamp + delay - 1);
        await placeBid(delayedJobBidInstance, userB, lowestBidAmount, queuedJobId, maxReward, collateralAmount);
        const balanceUserABefore = await ethers.provider.getBalance(userA.address);
        const balanceUserBPrior = await ethers.provider.getBalance(
          userB.address,
        );
        await time.setNextBlockTimestamp(timestamp + delay + 1);
        const tx = await delayedJobBidInstance
          .connect(userB)
          .execute(queuedJobId);

        const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
        if (!receipt) {
          throw new Error("No receipt");
        }

        // calculate gas used
        const gasUsed = receipt.gasUsed;

        // get the gas price from the transaction
        const txdetails = await ethers.provider.getTransaction(tx.hash);
        if (!txdetails) {
          throw new Error("No transaction details");
        }
        const gasPrice = txdetails.gasPrice;
        const gasCost = gasUsed * gasPrice;

        await expect(tx)
          .to.emit(delayedJobBidInstance, "JobExecuted")
          .withArgs(queuedJobId, deployedTargetAddr, userB.address, lowestBidAmount, collateralAmount);

          const balanceUserBAfter = await ethers.provider.getBalance(
          userB.address,
        );
        const balanceUserAAfter = await ethers.provider.getBalance(userA.address);
        // User B should have their collateral returned and the lowest bid amount
        expect(balanceUserBAfter - balanceUserBPrior + gasCost).to.equal(
          lowestBidAmount + collateralAmount,
        );
        // User A should have the reward - lowest bid amount returned
        expect(balanceUserAAfter - balanceUserABefore).to.equal(
          maxReward - lowestBidAmount,
        );

        // check value of TargetContract
        expect(await deployedTarget.value()).to.equal(1001);
      });
      
      it("should revert if the target contract function reverts", async function () {
        const funcSig = "testRevert()";
        const signature = ethers.dataSlice(
          ethers.keccak256(ethers.toUtf8Bytes(funcSig)),
          0,
          4,
        );
        const abiCoder = new ethers.AbiCoder();
        const data = abiCoder.encode(["uint256"], [100]);
        const newTimestamp = (await time.latest()) + 12 * 100;
        await time.setNextBlockTimestamp(newTimestamp);
        await delayedJobBidInstance.queueJob(
          deployedTargetAddr,
          signature,
          data,
          delay,
          maxReward,
          timeout,
          { value: maxReward }
        );
        const jobId = ethers.solidityPackedKeccak256(
          [
            "address",
            "bytes4",
            "bytes32",
            "uint32",
            "uint32",
            "uint128",
            "uint32",
          ],
          [
            deployedTargetAddr,
            signature,
            data,
            delay,
            newTimestamp,
            maxReward,
            timeout,
          ],
        );

        // place a bid to set the lowest bid
        lowestBidAmount = ethers.parseEther("0.6");
        collateralAmount = maxReward - lowestBidAmount;
        await time.setNextBlockTimestamp(newTimestamp + delay - 1);
        await placeBid(delayedJobBidInstance, userB, lowestBidAmount, jobId, maxReward, collateralAmount);
        
        // try and execute the job
        await time.setNextBlockTimestamp(newTimestamp + delay + 1);
        await expect(
          delayedJobBidInstance.connect(userB).execute(jobId),
        ).to.be.revertedWithCustomError(
          delayedJobBidInstance,
          "JobExecutionFailed",
        );
      });
    });
  });
});
