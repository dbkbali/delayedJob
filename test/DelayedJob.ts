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
import { DelayedJob, TargetContract } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("DelayedJob", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployDelayedJobFixture() {
    // Contracts are deployed using the first signer/account by default
    const [userA, userB] = await ethers.getSigners();

    const targetContract = await ethers.deployContract("TargetContract", [10]);
    await targetContract.waitForDeployment();
    const targetContractAddr = await targetContract.getAddress();

    const DelayedJob = await ethers.getContractFactory("DelayedJob");
    const delayedJob = await DelayedJob.deploy();

    return { targetContract, targetContractAddr, delayedJob, userA, userB };
  }

  describe("Deployment", function () {
    it("Should set owner to userA", async function () {
      const { delayedJob, userA } = await loadFixture(deployDelayedJobFixture);

      expect(await delayedJob.owner()).to.equal(userA.address);
    });
  });

  describe("QueueJob", function () {
    describe("Validations", async function () {
      let delayedJobInstance: DelayedJob & {
        deploymentTransaction(): ContractTransactionResponse;
      };
      let userB: HardhatEthersSigner;
      let deployedTargetContract: AddressLike | Typed;
      let notTargetContract: AddressLike | Typed;
      let signature: BytesLike;
      let data: BytesLike;
      let delay: number;
      let reward: bigint;
      let executor: AddressLike | Typed;

      beforeEach(async function () {
        const {
          targetContractAddr,
          delayedJob: dj,
          userB: b,
        } = await loadFixture(deployDelayedJobFixture);
        delayedJobInstance = dj;
        // userA = a;
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
        reward = ethers.parseEther("1");
        executor = userB.address;
      });

      it("should revert if not called by owner", async function () {
        await expect(
          delayedJobInstance
            .connect(userB)
            .queueJob(
              deployedTargetContract,
              signature,
              data,
              delay,
              reward,
              executor,
            ),
        ).to.be.revertedWithCustomError(delayedJobInstance, "NotOwner");
      });
      it("should revert if target contract does not exist", async function () {
        await expect(
          delayedJobInstance.queueJob(
            notTargetContract,
            signature,
            data,
            delay,
            reward,
            executor,
          ),
        )
          .to.be.revertedWithCustomError(
            delayedJobInstance,
            "TargetNotContract",
          )
          .withArgs(notTargetContract);
      });
      it("should revert if reward is not sufficient", async function () {
        expect(
          delayedJobInstance.queueJob(
            deployedTargetContract,
            signature,
            data,
            delay,
            reward,
            executor,
            { value: ethers.parseEther("0") },
          ),
        )
          .to.be.revertedWithCustomError(delayedJobInstance, "RewardNotEnough")
          .withArgs(0, reward);
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
            "uint256",
            "address",
          ],
          [
            deployedTargetContract,
            signature,
            data,
            delay,
            newTimestamp,
            reward,
            executor,
          ],
        );

        const tx = await delayedJobInstance.queueJob(
          deployedTargetContract,
          signature,
          data,
          delay,
          reward,
          executor,
          {
            value: reward,
          },
        );

        const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
        if (!receipt) {
          throw new Error("No receipt");
        }

        await expect(tx)
          .to.emit(delayedJobInstance, "JobQueued")
          .withArgs(
            expectedJobId,
            deployedTargetContract,
            signature,
            data,
            delay,
            newTimestamp,
            reward,
            executor,
          );
        // check jobs mapping
        const job = await delayedJobInstance.jobs(expectedJobId);
        expect(job.target).to.equal(deployedTargetContract);
        expect(job.signature).to.equal(signature);
        expect(job.data).to.equal(data);
        expect(job.createdAt).to.equal(newTimestamp);
        expect(job.delay).to.equal(delay);
        expect(job.reward).to.equal(reward);
        expect(job.executor).to.equal(executor);
      });
    });
  });
  describe("Execute", function () {
    describe("Validations", function () {
      let delayedJobInstance: DelayedJob & {
        deploymentTransaction(): ContractTransactionResponse;
      };
      let userA: HardhatEthersSigner;
      let userB: HardhatEthersSigner;
      let deployedTargetContractAddr: AddressLike | Typed;
      let signature: BytesLike;
      let data: BytesLike;
      let delay: number;
      let reward: bigint;
      let executor: string;
      let timestamp: number;
      let queuedJobId: BytesLike;
      let deployedTarget: TargetContract;

      beforeEach(async function () {
        const {
          targetContract,
          targetContractAddr,
          delayedJob: dj,
          userA: a,
          userB: b,
        } = await loadFixture(deployDelayedJobFixture);
        delayedJobInstance = dj;
        userA = a;
        userB = b;
        deployedTargetContractAddr = targetContractAddr;
        deployedTarget = targetContract;
        const funcSig = "testDj(uint256)";
        signature = ethers.dataSlice(
          ethers.keccak256(ethers.toUtf8Bytes(funcSig)),
          0,
          4,
        );
        delay = 60 * 60 * 24;
        reward = ethers.parseEther("1");
        executor = userB.address;
        const abiCoder = new ethers.AbiCoder();
        data = ethers.zeroPadValue(abiCoder.encode(["uint256"], [1001]), 32);
        const newTimestamp = (await time.latest()) + 12 * 100;
        timestamp = newTimestamp;
        await time.setNextBlockTimestamp(newTimestamp);
        await delayedJobInstance.queueJob(
          deployedTargetContractAddr,
          signature,
          data,
          delay,
          reward,
          executor,
          {
            value: reward,
          },
        );
        // non existent job id
        queuedJobId = ethers.solidityPackedKeccak256(
          [
            "address",
            "bytes4",
            "bytes32",
            "uint32",
            "uint32",
            "uint256",
            "address",
          ],
          [
            deployedTargetContractAddr,
            signature,
            data,
            delay,
            timestamp,
            reward,
            executor,
          ],
        );
      });

      it("should revert if job does not exist", async function () {
        const jobId = ethers.keccak256(ethers.randomBytes(32));
        await expect(delayedJobInstance.connect(userB).execute(jobId))
          .to.be.revertedWithCustomError(delayedJobInstance, "JobDoesNotExist")
          .withArgs(jobId);
      });

      it("should revert after delay if not called by executor", async function () {
        const queuedJobId = ethers.solidityPackedKeccak256(
          [
            "address",
            "bytes4",
            "bytes32",
            "uint32",
            "uint32",
            "uint256",
            "address",
          ],
          [
            deployedTargetContractAddr,
            signature,
            data,
            delay,
            timestamp,
            reward,
            userB.address,
          ],
        );

        await time.setNextBlockTimestamp(timestamp + delay + 1);
        await expect(delayedJobInstance.connect(userA).execute(queuedJobId))
          .to.be.revertedWithCustomError(delayedJobInstance, "NotJobExecutor")
          .withArgs(queuedJobId);
      });

      it("should revert if called before delay", async function () {
        await expect(delayedJobInstance.connect(userB).execute(queuedJobId))
          .to.be.revertedWithCustomError(delayedJobInstance, "JobNotReady")
          .withArgs(queuedJobId, timestamp + delay);
      });

      it("should execute job if called after delay by executor", async function () {
        const balanceUserBPrior = await ethers.provider.getBalance(
          userB.address,
        );
        await time.setNextBlockTimestamp(timestamp + delay + 1);
        const tx = await delayedJobInstance.connect(userB).execute(queuedJobId);

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
          .to.emit(delayedJobInstance, "JobExecuted")
          .withArgs(
            queuedJobId,
            deployedTargetContractAddr,
            userB.address,
            reward,
          );
        const balanceUserBAfter = await ethers.provider.getBalance(
          userB.address,
        );
        expect(balanceUserBAfter - balanceUserBPrior + gasCost).to.equal(
          reward,
        );

        // check value of TargetContract
        expect(await deployedTarget.value()).to.equal(1001);
      });

      it("should revert if called twice", async function () {
        await time.setNextBlockTimestamp(timestamp + delay + 1);
        await delayedJobInstance.connect(userB).execute(queuedJobId);
        await expect(delayedJobInstance.connect(userB).execute(queuedJobId))
          .to.be.revertedWithCustomError(delayedJobInstance, "JobDoesNotExist")
          .withArgs(queuedJobId);
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
        await delayedJobInstance.queueJob(
          deployedTargetContractAddr,
          signature,
          data,
          delay,
          reward,
          executor,
          {
            value: reward,
          },
        );

        const jobId = ethers.solidityPackedKeccak256(
          [
            "address",
            "bytes4",
            "bytes32",
            "uint32",
            "uint32",
            "uint256",
            "address",
          ],
          [
            deployedTargetContractAddr,
            signature,
            data,
            delay,
            newTimestamp,
            reward,
            executor,
          ],
        );
        await time.setNextBlockTimestamp(newTimestamp + delay + 1);
        await expect(
          delayedJobInstance.connect(userB).execute(jobId),
        ).to.be.revertedWithCustomError(
          delayedJobInstance,
          "JobExecutionFailed",
        );
      });
    });
  });
});
