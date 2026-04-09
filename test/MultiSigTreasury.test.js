const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("MultiSigTreasury", function () {
  let treasury;
  let exec1, exec2, exec3, outsider, recipient;
  const ONE_ETH  = ethers.parseEther("1.0");
  const HALF_ETH = ethers.parseEther("0.5");
  const EXPIRY   = 7 * 24 * 60 * 60; // 7 days in seconds

  async function timeTravel(seconds) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
  }

  beforeEach(async function () {
    [exec1, exec2, exec3, outsider, recipient] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("MultiSigTreasury");
    treasury = await Factory.deploy([exec1.address, exec2.address, exec3.address]);

    // Fund with 5 ETH
    await exec1.sendTransaction({ to: treasury.target, value: ethers.parseEther("5.0") });
  });

  // ─── Deployment ───────────────────────────────────────────

  describe("Deployment", function () {
    it("sets 3 executives correctly", async function () {
      const execs = await treasury.getExecutives();
      expect(execs[0]).to.equal(exec1.address);
      expect(execs[1]).to.equal(exec2.address);
      expect(execs[2]).to.equal(exec3.address);
    });

    it("marks each address as executive", async function () {
      expect(await treasury.isExecutive(exec1.address)).to.be.true;
      expect(await treasury.isExecutive(outsider.address)).to.be.false;
    });

    it("rejects deployment with != 3 executives", async function () {
      const F = await ethers.getContractFactory("MultiSigTreasury");
      await expect(F.deploy([exec1.address, exec2.address])).to.be.revertedWith("Need exactly 3 executives");
    });

    it("rejects duplicate executives", async function () {
      const F = await ethers.getContractFactory("MultiSigTreasury");
      await expect(
        F.deploy([exec1.address, exec1.address, exec2.address])
      ).to.be.revertedWith("Duplicate executive");
    });

    it("rejects zero address", async function () {
      const F = await ethers.getContractFactory("MultiSigTreasury");
      await expect(
        F.deploy([exec1.address, ethers.ZeroAddress, exec2.address])
      ).to.be.revertedWith("Zero address not allowed");
    });
  });

  // ─── Deposits & Donor Leaderboard ─────────────────────────

  describe("Deposits & Donor Leaderboard", function () {
    it("accepts ETH via receive()", async function () {
      await outsider.sendTransaction({ to: treasury.target, value: ONE_ETH });
      expect(await treasury.getBalance()).to.equal(ethers.parseEther("6.0"));
    });

    it("accepts ETH via deposit()", async function () {
      await treasury.connect(outsider).deposit({ value: ONE_ETH });
      expect(await treasury.getBalance()).to.equal(ethers.parseEther("6.0"));
    });

    it("emits Deposited event", async function () {
      await expect(
        treasury.connect(outsider).deposit({ value: ONE_ETH })
      ).to.emit(treasury, "Deposited").withArgs(outsider.address, ONE_ETH);
    });

    it("rejects zero-value deposit", async function () {
      await expect(
        treasury.connect(outsider).deposit({ value: 0 })
      ).to.be.revertedWith("Must send ETH");
    });

    it("tracks donor on first deposit", async function () {
      await treasury.connect(outsider).deposit({ value: ONE_ETH });
      expect(await treasury.getDonorCount()).to.equal(2); // exec1 (beforeEach) + outsider
      expect(await treasury.totalDonated(outsider.address)).to.equal(ONE_ETH);
    });

    it("accumulates multiple donations from same donor", async function () {
      await treasury.connect(outsider).deposit({ value: ONE_ETH });
      await treasury.connect(outsider).deposit({ value: HALF_ETH });
      expect(await treasury.totalDonated(outsider.address)).to.equal(ethers.parseEther("1.5"));
      expect(await treasury.getDonorCount()).to.equal(2); // no duplicate added
    });

    it("getDonor returns correct address and amount", async function () {
      await treasury.connect(outsider).deposit({ value: ONE_ETH });
      const d = await treasury.getDonor(1); // index 1 = outsider (0 = exec1 from beforeEach)
      expect(d.donor).to.equal(outsider.address);
      expect(d.amount).to.equal(ONE_ETH);
    });
  });

  // ─── Emergency Pause ──────────────────────────────────────

  describe("Emergency Pause", function () {
    it("requires 2 votes to pause", async function () {
      expect(await treasury.paused()).to.be.false;

      await treasury.connect(exec1).votePause();
      expect(await treasury.paused()).to.be.false; // only 1 vote

      await treasury.connect(exec2).votePause();
      expect(await treasury.paused()).to.be.true;  // 2 votes → paused
    });

    it("emits PauseVoteCast and ContractPaused events", async function () {
      await expect(treasury.connect(exec1).votePause())
        .to.emit(treasury, "PauseVoteCast").withArgs(exec1.address, 1);
      await expect(treasury.connect(exec2).votePause())
        .to.emit(treasury, "ContractPaused");
    });

    it("rejects double pause vote from same executive", async function () {
      await treasury.connect(exec1).votePause();
      await expect(
        treasury.connect(exec1).votePause()
      ).to.be.revertedWith("Already voted to pause");
    });

    it("blocks proposeTransaction when paused", async function () {
      await treasury.connect(exec1).votePause();
      await treasury.connect(exec2).votePause();

      await expect(
        treasury.connect(exec3).proposeTransaction(recipient.address, HALF_ETH, "test", "General")
      ).to.be.revertedWith("Contract is paused");
    });

    it("blocks approveTransaction when paused", async function () {
      // Propose before pausing
      await treasury.connect(exec1).proposeTransaction(recipient.address, HALF_ETH, "test", "General");

      await treasury.connect(exec2).votePause();
      await treasury.connect(exec3).votePause();

      await expect(
        treasury.connect(exec2).approveTransaction(0)
      ).to.be.revertedWith("Contract is paused");
    });

    it("blocks executeTransaction when paused", async function () {
      await treasury.connect(exec1).proposeTransaction(recipient.address, HALF_ETH, "test", "General");
      await treasury.connect(exec2).approveTransaction(0);

      await treasury.connect(exec1).votePause();
      await treasury.connect(exec3).votePause();

      await expect(
        treasury.connect(exec1).executeTransaction(0)
      ).to.be.revertedWith("Contract is paused");
    });

    it("requires 2 votes to unpause", async function () {
      await treasury.connect(exec1).votePause();
      await treasury.connect(exec2).votePause();
      expect(await treasury.paused()).to.be.true;

      await treasury.connect(exec1).voteUnpause();
      expect(await treasury.paused()).to.be.true;  // only 1 unpause vote

      await treasury.connect(exec2).voteUnpause();
      expect(await treasury.paused()).to.be.false; // 2 votes → unpaused
    });

    it("emits ContractUnpaused event", async function () {
      await treasury.connect(exec1).votePause();
      await treasury.connect(exec2).votePause();
      await treasury.connect(exec1).voteUnpause();
      await expect(
        treasury.connect(exec3).voteUnpause()
      ).to.emit(treasury, "ContractUnpaused");
    });

    it("rejects voteUnpause when not paused", async function () {
      await expect(
        treasury.connect(exec1).voteUnpause()
      ).to.be.revertedWith("Not paused");
    });

    it("rejects double unpause vote", async function () {
      await treasury.connect(exec1).votePause();
      await treasury.connect(exec2).votePause();
      await treasury.connect(exec1).voteUnpause();
      await expect(
        treasury.connect(exec1).voteUnpause()
      ).to.be.revertedWith("Already voted to unpause");
    });

    it("resets pause votes after unpause so contract can be paused again", async function () {
      // First pause cycle
      await treasury.connect(exec1).votePause();
      await treasury.connect(exec2).votePause();
      // Unpause
      await treasury.connect(exec1).voteUnpause();
      await treasury.connect(exec2).voteUnpause();
      // Should be able to pause again
      await treasury.connect(exec1).votePause();
      await treasury.connect(exec2).votePause();
      expect(await treasury.paused()).to.be.true;
    });

    it("rejects non-executive pause vote", async function () {
      await expect(
        treasury.connect(outsider).votePause()
      ).to.be.revertedWith("Not an executive");
    });
  });

  // ─── Category Budget Caps ─────────────────────────────────

  describe("Category Budget Caps", function () {
    it("allows executive to set a budget cap", async function () {
      await treasury.connect(exec1).setCategoryBudget("Events", ethers.parseEther("2.0"));
      const info = await treasury.getCategoryInfo("Events");
      expect(info.cap).to.equal(ethers.parseEther("2.0"));
      expect(info.spent).to.equal(0);
    });

    it("emits BudgetSet event", async function () {
      await expect(
        treasury.connect(exec1).setCategoryBudget("Supplies", ONE_ETH)
      ).to.emit(treasury, "BudgetSet").withArgs("Supplies", ONE_ETH);
    });

    it("rejects proposal that would exceed category budget", async function () {
      await treasury.connect(exec1).setCategoryBudget("Events", HALF_ETH);

      await expect(
        treasury.connect(exec1).proposeTransaction(recipient.address, ONE_ETH, "Too big", "Events")
      ).to.be.revertedWith("Category budget exceeded");
    });

    it("allows proposal within budget cap", async function () {
      await treasury.connect(exec1).setCategoryBudget("Events", ethers.parseEther("2.0"));
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, ONE_ETH, "Within budget", "Events"
      );
      expect(await treasury.getTransactionCount()).to.equal(1);
    });

    it("tracks category spending after execution", async function () {
      await treasury.connect(exec1).setCategoryBudget("Events", ethers.parseEther("3.0"));
      await treasury.connect(exec1).proposeTransaction(recipient.address, ONE_ETH, "Event A", "Events");
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec1).executeTransaction(0);

      const info = await treasury.getCategoryInfo("Events");
      expect(info.spent).to.equal(ONE_ETH);
    });

    it("rejects proposal when cumulative spend would exceed budget", async function () {
      // Cap 1.5 ETH, spend 1 ETH first
      await treasury.connect(exec1).setCategoryBudget("Events", ethers.parseEther("1.5"));
      await treasury.connect(exec1).proposeTransaction(recipient.address, ONE_ETH, "Event A", "Events");
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec1).executeTransaction(0);

      // categorySpent["Events"] = 1 ETH; remaining = 0.5 ETH.
      // Proposing 1 ETH more would push total to 2 ETH > 1.5 cap — rejected at propose time.
      await expect(
        treasury.connect(exec2).proposeTransaction(recipient.address, ONE_ETH, "Event B", "Events")
      ).to.be.revertedWith("Category budget exceeded");
    });

    it("no cap (budget = 0) allows any amount", async function () {
      // Default is 0 (no cap)
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, ethers.parseEther("4.0"), "Big event", "Events"
      );
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec1).executeTransaction(0);
      const info = await treasury.getCategoryInfo("Events");
      expect(info.spent).to.equal(ethers.parseEther("4.0"));
    });

    it("rejects setCategoryBudget from non-executive", async function () {
      await expect(
        treasury.connect(outsider).setCategoryBudget("Events", ONE_ETH)
      ).to.be.revertedWith("Not an executive");
    });
  });

  // ─── Propose Transaction ──────────────────────────────────

  describe("Propose Transaction", function () {
    it("auto-approves the proposer (approvalCount starts at 1)", async function () {
      await treasury.connect(exec3).proposeTransaction(
        recipient.address, HALF_ETH, "Buy markers", "Supplies"
      );
      expect(await treasury.hasApproved(0, exec3.address)).to.be.true;
      const tx = await treasury.getTransaction(0);
      expect(tx.approvalCount).to.equal(1);
    });

    it("stores all fields including category", async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Hackathon prizes", "Events"
      );
      const tx = await treasury.getTransaction(0);
      expect(tx.to).to.equal(recipient.address);
      expect(tx.value).to.equal(HALF_ETH);
      expect(tx.description).to.equal("Hackathon prizes");
      expect(tx.category).to.equal("Events");
      expect(tx.executed).to.be.false;
      expect(tx.cancelled).to.be.false;
    });

    it("emits TransactionProposed with category", async function () {
      await expect(
        treasury.connect(exec1).proposeTransaction(recipient.address, HALF_ETH, "Pizza", "Events")
      ).to.emit(treasury, "TransactionProposed")
        .withArgs(0, exec1.address, recipient.address, HALF_ETH, "Pizza", "Events");
    });

    it("rejects proposal from non-executive", async function () {
      await expect(
        treasury.connect(outsider).proposeTransaction(recipient.address, HALF_ETH, "hack", "General")
      ).to.be.revertedWith("Not an executive");
    });

    it("rejects proposal exceeding treasury balance", async function () {
      await expect(
        treasury.connect(exec1).proposeTransaction(
          recipient.address, ethers.parseEther("100"), "Too much", "Events"
        )
      ).to.be.revertedWith("Insufficient treasury balance");
    });
  });

  // ─── Approve Transaction ──────────────────────────────────

  describe("Approve Transaction", function () {
    beforeEach(async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Test spend", "General"
      );
    });

    it("allows a second executive to approve", async function () {
      await treasury.connect(exec2).approveTransaction(0);
      const tx = await treasury.getTransaction(0);
      expect(tx.approvalCount).to.equal(2);
    });

    it("allows unanimous 3-of-3 approval", async function () {
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec3).approveTransaction(0);
      const tx = await treasury.getTransaction(0);
      expect(tx.approvalCount).to.equal(3);
    });

    it("rejects double approval — proposer already auto-approved", async function () {
      await expect(
        treasury.connect(exec1).approveTransaction(0)
      ).to.be.revertedWith("Already approved");
    });

    it("rejects approval from non-executive", async function () {
      await expect(
        treasury.connect(outsider).approveTransaction(0)
      ).to.be.revertedWith("Not an executive");
    });

    it("rejects approval for non-existent transaction", async function () {
      await expect(
        treasury.connect(exec2).approveTransaction(99)
      ).to.be.revertedWith("Transaction does not exist");
    });
  });

  // ─── Revoke Approval ──────────────────────────────────────

  describe("Revoke Approval", function () {
    beforeEach(async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Test spend", "General"
      );
    });

    it("allows revoking the auto-approval", async function () {
      await treasury.connect(exec1).revokeApproval(0);
      const tx = await treasury.getTransaction(0);
      expect(tx.approvalCount).to.equal(0);
      expect(await treasury.hasApproved(0, exec1.address)).to.be.false;
    });

    it("emits ApprovalRevoked event", async function () {
      await expect(
        treasury.connect(exec1).revokeApproval(0)
      ).to.emit(treasury, "ApprovalRevoked").withArgs(0, exec1.address);
    });

    it("rejects revoking if not yet approved", async function () {
      await expect(
        treasury.connect(exec2).revokeApproval(0)
      ).to.be.revertedWith("Not approved yet");
    });
  });

  // ─── Execute Transaction ──────────────────────────────────

  describe("Execute Transaction", function () {
    beforeEach(async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, ONE_ETH, "Send 1 ETH", "Events"
      );
    });

    it("executes with 2 approvals: proposer auto + one more", async function () {
      await treasury.connect(exec2).approveTransaction(0);

      const before = await ethers.provider.getBalance(recipient.address);
      await treasury.connect(exec3).executeTransaction(0);
      const after = await ethers.provider.getBalance(recipient.address);

      expect(after - before).to.equal(ONE_ETH);
      expect((await treasury.getTransaction(0)).executed).to.be.true;
    });

    it("executes with unanimous 3-of-3", async function () {
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec3).approveTransaction(0);
      await treasury.connect(exec1).executeTransaction(0);
      expect((await treasury.getTransaction(0)).executed).to.be.true;
    });

    it("emits TransactionExecuted event", async function () {
      await treasury.connect(exec2).approveTransaction(0);
      await expect(
        treasury.connect(exec1).executeTransaction(0)
      ).to.emit(treasury, "TransactionExecuted").withArgs(0, exec1.address);
    });

    it("rejects with only 1 approval (proposer's auto)", async function () {
      await expect(
        treasury.connect(exec2).executeTransaction(0)
      ).to.be.revertedWith("Not enough approvals");
    });

    it("rejects after proposer revokes their approval", async function () {
      await treasury.connect(exec1).revokeApproval(0);
      await expect(
        treasury.connect(exec2).executeTransaction(0)
      ).to.be.revertedWith("Not enough approvals");
    });

    it("rejects double execution", async function () {
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec1).executeTransaction(0);
      await expect(
        treasury.connect(exec1).executeTransaction(0)
      ).to.be.revertedWith("Already executed");
    });

    it("rejects execution from non-executive", async function () {
      await treasury.connect(exec2).approveTransaction(0);
      await expect(
        treasury.connect(outsider).executeTransaction(0)
      ).to.be.revertedWith("Not an executive");
    });
  });

  // ─── Transaction Expiry ───────────────────────────────────

  describe("Transaction Expiry", function () {
    beforeEach(async function () {
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, HALF_ETH, "Old proposal", "General"
      );
    });

    it("rejects cancelling a fresh (non-expired) proposal", async function () {
      await expect(
        treasury.connect(exec2).cancelExpiredTransaction(0)
      ).to.be.revertedWith("Not expired yet");
    });

    it("allows cancelling after 7-day expiry", async function () {
      await timeTravel(EXPIRY + 1);
      await treasury.connect(exec2).cancelExpiredTransaction(0);
      expect((await treasury.getTransaction(0)).cancelled).to.be.true;
    });

    it("emits TransactionCancelled event", async function () {
      await timeTravel(EXPIRY + 1);
      await expect(
        treasury.connect(exec1).cancelExpiredTransaction(0)
      ).to.emit(treasury, "TransactionCancelled").withArgs(0);
    });

    it("rejects approving a cancelled proposal", async function () {
      await timeTravel(EXPIRY + 1);
      await treasury.connect(exec1).cancelExpiredTransaction(0);
      await expect(
        treasury.connect(exec2).approveTransaction(0)
      ).to.be.revertedWith("Transaction cancelled");
    });

    it("rejects cancelling an already executed proposal", async function () {
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec1).executeTransaction(0);
      await timeTravel(EXPIRY + 1);
      await expect(
        treasury.connect(exec1).cancelExpiredTransaction(0)
      ).to.be.revertedWith("Already executed");
    });
  });

  // ─── Executive Replacement ────────────────────────────────

  describe("Executive Replacement", function () {
    it("proposes and auto-approves the proposer", async function () {
      await treasury.connect(exec2).proposeReplacement(exec1.address, outsider.address);
      expect(await treasury.replacementApprovals(0, exec2.address)).to.be.true;
      expect((await treasury.getReplacement(0)).approvalCount).to.equal(1);
    });

    it("executes replacement with 2 approvals", async function () {
      await treasury.connect(exec2).proposeReplacement(exec1.address, outsider.address);
      await treasury.connect(exec3).approveReplacement(0);
      await treasury.connect(exec2).executeReplacement(0);

      expect(await treasury.isExecutive(exec1.address)).to.be.false;
      expect(await treasury.isExecutive(outsider.address)).to.be.true;
    });

    it("emits ExecutiveReplaced event", async function () {
      await treasury.connect(exec2).proposeReplacement(exec1.address, outsider.address);
      await treasury.connect(exec3).approveReplacement(0);
      await expect(
        treasury.connect(exec2).executeReplacement(0)
      ).to.emit(treasury, "ExecutiveReplaced").withArgs(exec1.address, outsider.address);
    });

    it("rejects proposing a non-executive for replacement", async function () {
      await expect(
        treasury.connect(exec2).proposeReplacement(outsider.address, recipient.address)
      ).to.be.revertedWith("Old address is not an executive");
    });

    it("rejects replacing with an existing executive address", async function () {
      await expect(
        treasury.connect(exec2).proposeReplacement(exec1.address, exec3.address)
      ).to.be.revertedWith("New address is already an executive");
    });

    it("rejects execution without enough approvals", async function () {
      await treasury.connect(exec2).proposeReplacement(exec1.address, outsider.address);
      await expect(
        treasury.connect(exec2).executeReplacement(0)
      ).to.be.revertedWith("Not enough approvals");
    });
  });

  // ─── Executive Aliases (Pseudonymity) ────────────────────

  describe("Executive Aliases", function () {
    it("allows an executive to set a display alias", async function () {
      await treasury.connect(exec1).setAlias("Alice");
      expect(await treasury.executiveAlias(exec1.address)).to.equal("Alice");
    });

    it("emits AliasSet event", async function () {
      await expect(
        treasury.connect(exec2).setAlias("Bob")
      ).to.emit(treasury, "AliasSet").withArgs(exec2.address, "Bob");
    });

    it("getAliasOrAddress returns alias when set", async function () {
      await treasury.connect(exec1).setAlias("President-K");
      const result = await treasury.getAliasOrAddress(exec1.address);
      expect(result).to.equal("President-K");
    });

    it("getAliasOrAddress returns hex address when no alias set", async function () {
      const result = await treasury.getAliasOrAddress(exec2.address);
      expect(result.toLowerCase()).to.equal(exec2.address.toLowerCase());
    });

    it("allows clearing alias by setting empty string", async function () {
      await treasury.connect(exec1).setAlias("Temp");
      await treasury.connect(exec1).setAlias("");
      expect(await treasury.executiveAlias(exec1.address)).to.equal("");
    });

    it("rejects alias from non-executive", async function () {
      await expect(
        treasury.connect(outsider).setAlias("Hacker")
      ).to.be.revertedWith("Not an executive");
    });

    it("each executive has an independent alias", async function () {
      await treasury.connect(exec1).setAlias("Alice");
      await treasury.connect(exec2).setAlias("Bob");
      expect(await treasury.executiveAlias(exec1.address)).to.equal("Alice");
      expect(await treasury.executiveAlias(exec2.address)).to.equal("Bob");
      expect(await treasury.executiveAlias(exec3.address)).to.equal(""); // not set
    });
  });

  // ─── End-to-End Scenarios ─────────────────────────────────

  describe("End-to-End: Student Club Scenarios", function () {
    it("full spending workflow: deposit → propose → approve → execute", async function () {
      await treasury.connect(outsider).deposit({ value: ethers.parseEther("2.0") });

      await treasury.connect(exec1).proposeTransaction(
        recipient.address,
        ethers.parseEther("1.5"),
        "Buy robotics kit",
        "Equipment"
      );
      await treasury.connect(exec2).approveTransaction(0);

      const before = await ethers.provider.getBalance(recipient.address);
      await treasury.connect(exec1).executeTransaction(0);
      const after = await ethers.provider.getBalance(recipient.address);

      expect(after - before).to.equal(ethers.parseEther("1.5"));
    });

    it("pause during suspicious activity, then unpause and resume", async function () {
      await treasury.connect(exec1).proposeTransaction(recipient.address, HALF_ETH, "Normal", "General");
      await treasury.connect(exec2).approveTransaction(0);

      // Suspicious — exec1 and exec2 vote to pause
      await treasury.connect(exec1).votePause();
      await treasury.connect(exec2).votePause();
      expect(await treasury.paused()).to.be.true;

      // Cannot execute while paused
      await expect(
        treasury.connect(exec1).executeTransaction(0)
      ).to.be.revertedWith("Contract is paused");

      // Investigation complete — unpause
      await treasury.connect(exec1).voteUnpause();
      await treasury.connect(exec3).voteUnpause();
      expect(await treasury.paused()).to.be.false;

      // Execute succeeds now
      await treasury.connect(exec1).executeTransaction(0);
      expect((await treasury.getTransaction(0)).executed).to.be.true;
    });

    it("budget cap enforced across multiple proposals in same category", async function () {
      await treasury.connect(exec1).setCategoryBudget("Events", ethers.parseEther("1.5"));

      // First event: 1 ETH — OK
      await treasury.connect(exec1).proposeTransaction(
        recipient.address, ONE_ETH, "Event A", "Events"
      );
      await treasury.connect(exec2).approveTransaction(0);
      await treasury.connect(exec1).executeTransaction(0);

      // Second event: 1 ETH — would exceed cap (0.5 remaining)
      await expect(
        treasury.connect(exec2).proposeTransaction(
          recipient.address, ONE_ETH, "Event B", "Events"
        )
      ).to.be.revertedWith("Category budget exceeded");

      // Smaller amount within remaining budget — OK
      await treasury.connect(exec2).proposeTransaction(
        recipient.address, HALF_ETH, "Event B (scaled)", "Events"
      );
      expect(await treasury.getTransactionCount()).to.equal(2);
    });

    it("executive replacement: Treasurer loses key", async function () {
      const newTreasurer = outsider.address;
      await treasury.connect(exec2).proposeReplacement(exec3.address, newTreasurer);
      await treasury.connect(exec1).approveReplacement(0);
      await treasury.connect(exec2).executeReplacement(0);

      // New treasurer can propose
      await treasury.connect(outsider).proposeTransaction(
        recipient.address, HALF_ETH, "New Treasurer's first proposal", "General"
      );
      expect(await treasury.getTransactionCount()).to.equal(1);
    });

    it("donor leaderboard tracks multiple contributors", async function () {
      await treasury.connect(exec2).deposit({ value: ONE_ETH });
      await treasury.connect(exec3).deposit({ value: ethers.parseEther("2.0") });
      await treasury.connect(outsider).deposit({ value: HALF_ETH });

      // exec1 donated in beforeEach (5 ETH), so 4 unique donors
      expect(await treasury.getDonorCount()).to.equal(4);
      expect(await treasury.totalDonated(exec3.address)).to.equal(ethers.parseEther("2.0"));
    });
  });
});
