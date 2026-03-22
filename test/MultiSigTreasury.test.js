const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigTreasury", function () {
  let treasury;
  let exec1, exec2, exec3, outsider, recipient;
  const ONE_ETH = ethers.parseEther("1.0");
  const HALF_ETH = ethers.parseEther("0.5");

  beforeEach(async function () {
    [exec1, exec2, exec3, outsider, recipient] = await ethers.getSigners();

    const MultiSigTreasury = await ethers.getContractFactory("MultiSigTreasury");
    treasury = await MultiSigTreasury.deploy([
      exec1.address,
      exec2.address,
      exec3.address,
    ]);

    // Fund the treasury with 5 ETH
    await exec1.sendTransaction({ to: treasury.target, value: ethers.parseEther("5.0") });
  });

  // ─── Deployment ────────────────────────────────────

  describe("Deployment", function () {
    it("should set 3 executives correctly", async function () {
      const execs = await treasury.getExecutives();
      expect(execs.length).to.equal(3);
      expect(execs[0]).to.equal(exec1.address);
      expect(execs[1]).to.equal(exec2.address);
      expect(execs[2]).to.equal(exec3.address);
    });

    it("should mark each address as executive", async function () {
      expect(await treasury.isExecutive(exec1.address)).to.be.true;
      expect(await treasury.isExecutive(exec2.address)).to.be.true;
      expect(await treasury.isExecutive(exec3.address)).to.be.true;
      expect(await treasury.isExecutive(outsider.address)).to.be.false;
    });

    it("should reject deployment with != 3 executives", async function () {
      const Factory = await ethers.getContractFactory("MultiSigTreasury");
      await expect(
        Factory.deploy([exec1.address, exec2.address])
      ).to.be.revertedWith("Need exactly 3 executives");
    });

    it("should reject duplicate executives", async function () {
      const Factory = await ethers.getContractFactory("MultiSigTreasury");
      await expect(
        Factory.deploy([exec1.address, exec1.address, exec2.address])
      ).to.be.revertedWith("Duplicate executive");
    });

    it("should reject zero address", async function () {
      const Factory = await ethers.getContractFactory("MultiSigTreasury");
      await expect(
        Factory.deploy([exec1.address, ethers.ZeroAddress, exec2.address])
      ).to.be.revertedWith("Zero address not allowed");
    });
  });

  // ─── Deposits ──────────────────────────────────────

  describe("Deposits", function () {
    it("should accept ETH via receive()", async function () {
      await outsider.sendTransaction({ to: treasury.target, value: ONE_ETH });
      expect(await treasury.getBalance()).to.equal(ethers.parseEther("6.0"));
    });

    it("should accept ETH via deposit()", async function () {
      await treasury.connect(outsider).deposit({ value: ONE_ETH });
      expect(await treasury.getBalance()).to.equal(ethers.parseEther("6.0"));
    });

    it("should emit Deposited event", async function () {
      await expect(
        treasury.connect(outsider).deposit({ value: ONE_ETH })
      ).to.emit(treasury, "Deposited").withArgs(outsider.address, ONE_ETH);
    });

    it("should reject zero-value deposit", async function () {
      await expect(
        treasury.connect(outsider).deposit({ value: 0 })
      ).to.be.revertedWith("Must send ETH");
    });
  });

  // ─── Propose Transaction ──────────────────────────

  describe("Propose Transaction", function () {
    it("should allow an executive to propose", async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Buy club T-shirts"
      );
      expect(await treasury.getTransactionCount()).to.equal(1);
    });

    it("should emit TransactionProposed event", async function () {
      await expect(
        treasury.connect(exec1).proposeTransaction(
          recipient.address, HALF_ETH, "Club pizza party"
        )
      ).to.emit(treasury, "TransactionProposed")
        .withArgs(0, exec1.address, recipient.address, HALF_ETH, "Club pizza party");
    });

    it("should store correct transaction data", async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Hackathon prizes"
      );
      const tx = await treasury.getTransaction(0);
      expect(tx.to).to.equal(recipient.address);
      expect(tx.value).to.equal(HALF_ETH);
      expect(tx.description).to.equal("Hackathon prizes");
      expect(tx.executed).to.be.false;
      expect(tx.approvalCount).to.equal(0);
    });

    it("should reject proposal from non-executive", async function () {
      await expect(
        treasury.connect(outsider).proposeTransaction(
          recipient.address, HALF_ETH, "Unauthorized"
        )
      ).to.be.revertedWith("Not an executive");
    });

    it("should reject proposal exceeding balance", async function () {
      await expect(
        treasury.connect(exec1).proposeTransaction(
          recipient.address, ethers.parseEther("100"), "Too much"
        )
      ).to.be.revertedWith("Insufficient treasury balance");
    });
  });

  // ─── Approve Transaction ──────────────────────────

  describe("Approve Transaction", function () {
    beforeEach(async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Test spend"
      );
    });

    it("should allow executive to approve", async function () {
      await treasury.connect(exec1).approveTransaction(0);
      const tx = await treasury.getTransaction(0);
      expect(tx.approvalCount).to.equal(1);
      expect(await treasury.hasApproved(0, exec1.address)).to.be.true;
    });

    it("should emit TransactionApproved event", async function () {
      await expect(
        treasury.connect(exec2).approveTransaction(0)
      ).to.emit(treasury, "TransactionApproved").withArgs(0, exec2.address);
    });

    it("should reject double approval from same executive", async function () {
      await treasury.connect(exec1).approveTransaction(0);
      await expect(
        treasury.connect(exec1).approveTransaction(0)
      ).to.be.revertedWith("Already approved");
    });

    it("should reject approval from non-executive", async function () {
      await expect(
        treasury.connect(outsider).approveTransaction(0)
      ).to.be.revertedWith("Not an executive");
    });

    it("should reject approval for non-existent transaction", async function () {
      await expect(
        treasury.connect(exec1).approveTransaction(99)
      ).to.be.revertedWith("Transaction does not exist");
    });
  });

  // ─── Revoke Approval ──────────────────────────────

  describe("Revoke Approval", function () {
    beforeEach(async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Test spend"
      );
      await treasury.connect(exec1).approveTransaction(0);
    });

    it("should allow revoking an approval", async function () {
      await treasury.connect(exec1).revokeApproval(0);
      const tx = await treasury.getTransaction(0);
      expect(tx.approvalCount).to.equal(0);
      expect(await treasury.hasApproved(0, exec1.address)).to.be.false;
    });

    it("should emit ApprovalRevoked event", async function () {
      await expect(
        treasury.connect(exec1).revokeApproval(0)
      ).to.emit(treasury, "ApprovalRevoked").withArgs(0, exec1.address);
    });

    it("should reject revoking if not yet approved", async function () {
      await expect(
        treasury.connect(exec2).revokeApproval(0)
      ).to.be.revertedWith("Not approved yet");
    });
  });

  // ─── Execute Transaction ──────────────────────────

  describe("Execute Transaction", function () {
    beforeEach(async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, ONE_ETH, "Send 1 ETH"
      );
    });

    it("should execute with 2 approvals (happy path)", async function () {
      await treasury.connect(exec1).approveTransaction(0);
      await treasury.connect(exec2).approveTransaction(0);

      const balanceBefore = await ethers.provider.getBalance(recipient.address);
      await treasury.connect(exec3).executeTransaction(0);
      const balanceAfter = await ethers.provider.getBalance(recipient.address);

      expect(balanceAfter - balanceBefore).to.equal(ONE_ETH);

      const tx = await treasury.getTransaction(0);
      expect(tx.executed).to.be.true;
    });

    it("should execute with 3 approvals", async function () {
      await treasury.connect(exec1).approveTransaction(0);
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec3).approveTransaction(0);

      await treasury.connect(exec1).executeTransaction(0);
      const tx = await treasury.getTransaction(0);
      expect(tx.executed).to.be.true;
    });

    it("should emit TransactionExecuted event", async function () {
      await treasury.connect(exec1).approveTransaction(0);
      await treasury.connect(exec2).approveTransaction(0);

      await expect(
        treasury.connect(exec1).executeTransaction(0)
      ).to.emit(treasury, "TransactionExecuted").withArgs(0, exec1.address);
    });

    it("should REJECT with only 1 approval", async function () {
      await treasury.connect(exec1).approveTransaction(0);
      await expect(
        treasury.connect(exec1).executeTransaction(0)
      ).to.be.revertedWith("Not enough approvals");
    });

    it("should REJECT with 0 approvals", async function () {
      await expect(
        treasury.connect(exec1).executeTransaction(0)
      ).to.be.revertedWith("Not enough approvals");
    });

    it("should reject double execution", async function () {
      await treasury.connect(exec1).approveTransaction(0);
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec1).executeTransaction(0);

      await expect(
        treasury.connect(exec1).executeTransaction(0)
      ).to.be.revertedWith("Already executed");
    });

    it("should reject execution from non-executive", async function () {
      await treasury.connect(exec1).approveTransaction(0);
      await treasury.connect(exec2).approveTransaction(0);

      await expect(
        treasury.connect(outsider).executeTransaction(0)
      ).to.be.revertedWith("Not an executive");
    });
  });

  // ─── End-to-End Scenario ──────────────────────────

  describe("End-to-End: Student Club Scenario", function () {
    it("full workflow: deposit → propose → approve × 2 → execute", async function () {
      // Club member donates
      await treasury.connect(outsider).deposit({ value: ethers.parseEther("2.0") });

      // President proposes buying equipment
      await treasury.connect(exec1).proposeTransaction(
        recipient.address,
        ethers.parseEther("1.5"),
        "Buy robotics kit for club competition"
      );

      // Vice-president approves
      await treasury.connect(exec2).approveTransaction(0);
      // Treasurer approves
      await treasury.connect(exec3).approveTransaction(0);

      // President executes
      const balBefore = await ethers.provider.getBalance(recipient.address);
      await treasury.connect(exec1).executeTransaction(0);
      const balAfter = await ethers.provider.getBalance(recipient.address);

      expect(balAfter - balBefore).to.equal(ethers.parseEther("1.5"));
    });

    it("multiple proposals in parallel", async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Proposal A"
      );
      await treasury.connect(exec2).proposeTransaction(
        recipient.address, HALF_ETH, "Proposal B"
      );

      expect(await treasury.getTransactionCount()).to.equal(2);

      // Approve & execute only proposal B
      await treasury.connect(exec1).approveTransaction(1);
      await treasury.connect(exec3).approveTransaction(1);
      await treasury.connect(exec2).executeTransaction(1);

      const txA = await treasury.getTransaction(0);
      const txB = await treasury.getTransaction(1);
      expect(txA.executed).to.be.false;
      expect(txB.executed).to.be.true;
    });
  });
});
