// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  MultiSigTreasury
 * @notice 2-of-3 multi-signature treasury for student club executives.
 *         Any spending proposal must be approved by at least 2 out of 3
 *         registered executives before funds can be released.
 *
 * @dev    Feature list:
 *           1. 2-of-3 multi-sig with proposer auto-approval
 *           2. Spending categories with optional per-category budget caps
 *           3. 7-day proposal expiry (stale proposals may be cancelled)
 *           4. Executive address replacement via 2-of-3 governance
 *           5. Emergency pause — 2-of-3 vote freezes all spending
 *           6. Donor leaderboard — cumulative ETH donated tracked on-chain
 */
contract MultiSigTreasury {

    // ─────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────

    uint256 public constant REQUIRED_APPROVALS = 2;
    uint256 public constant MAX_EXECUTIVES     = 3;
    uint256 public constant EXPIRY_PERIOD      = 7 days;

    // ─────────────────────────────────────────────────
    //  State — Executives
    // ─────────────────────────────────────────────────

    address[] public executives;
    mapping(address => bool) public isExecutive;

    // ─────────────────────────────────────────────────
    //  State — Emergency Pause
    // ─────────────────────────────────────────────────

    bool    public paused;
    uint256 public pauseVoteCount;
    mapping(address => bool) public hasPauseVoted;

    uint256 public unpauseVoteCount;
    mapping(address => bool) public hasUnpauseVoted;

    // ─────────────────────────────────────────────────
    //  State — Spending Transactions
    // ─────────────────────────────────────────────────

    struct Transaction {
        address to;
        uint256 value;
        string  description;
        string  category;       // "Supplies" | "Events" | "Equipment" | ...
        bool    executed;
        bool    cancelled;
        uint256 approvalCount;
        uint256 createdAt;      // block.timestamp at proposal time
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    // ─────────────────────────────────────────────────
    //  State — Category Budget Caps
    // ─────────────────────────────────────────────────

    // Key = keccak256(abi.encodePacked(categoryName))
    // 0 means no cap.
    mapping(bytes32 => uint256) public categoryBudget;
    mapping(bytes32 => uint256) public categorySpent;

    // ─────────────────────────────────────────────────
    //  State — Executive Replacement
    // ─────────────────────────────────────────────────

    struct ExecReplacement {
        address oldExec;
        address newExec;
        uint256 approvalCount;
        bool    executed;
    }

    ExecReplacement[] public replacements;
    mapping(uint256 => mapping(address => bool)) public replacementApprovals;

    // ─────────────────────────────────────────────────
    //  State — Donor Leaderboard
    // ─────────────────────────────────────────────────

    mapping(address => uint256) public totalDonated;
    address[] private _donors;
    mapping(address => bool) private _isDonor;

    // ─────────────────────────────────────────────────
    //  State — Executive Aliases (pseudonymity)
    // ─────────────────────────────────────────────────

    // Executives can set a display name so the DApp shows "Alice" instead
    // of their raw 0x... address.  The mapping is public so anyone can read
    // it, but only the executive themselves can write it — preserving the
    // link between real identity and address as private knowledge.
    mapping(address => string) public executiveAlias;

    // ─────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────

    event Deposited(address indexed sender, uint256 amount);

    event TransactionProposed(
        uint256 indexed txIndex,
        address indexed proposer,
        address to,
        uint256 value,
        string  description,
        string  category
    );
    event TransactionApproved(uint256 indexed txIndex, address indexed approver);
    event ApprovalRevoked(uint256 indexed txIndex, address indexed revoker);
    event TransactionExecuted(uint256 indexed txIndex, address indexed executor);
    event TransactionCancelled(uint256 indexed txIndex);

    event BudgetSet(string category, uint256 cap);

    event PauseVoteCast(address indexed voter, uint256 voteCount);
    event ContractPaused();
    event UnpauseVoteCast(address indexed voter, uint256 voteCount);
    event ContractUnpaused();

    event ReplacementProposed(
        uint256 indexed replIndex,
        address indexed oldExec,
        address indexed newExec
    );
    event ReplacementApproved(uint256 indexed replIndex, address indexed approver);
    event ExecutiveReplaced(address indexed oldExec, address indexed newExec);

    event AliasSet(address indexed executive, string displayName);

    // ─────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────

    modifier onlyExecutive() {
        require(isExecutive[msg.sender], "Not an executive");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier txExists(uint256 _txIndex) {
        require(_txIndex < transactions.length, "Transaction does not exist");
        _;
    }

    modifier notExecuted(uint256 _txIndex) {
        require(!transactions[_txIndex].executed, "Already executed");
        _;
    }

    modifier notCancelled(uint256 _txIndex) {
        require(!transactions[_txIndex].cancelled, "Transaction cancelled");
        _;
    }

    // ─────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────

    /**
     * @param _executives Exactly 3 unique, non-zero addresses that will
     *                    control this treasury.
     */
    constructor(address[] memory _executives) {
        require(_executives.length == MAX_EXECUTIVES, "Need exactly 3 executives");

        for (uint256 i = 0; i < _executives.length; i++) {
            address exec = _executives[i];
            require(exec != address(0), "Zero address not allowed");
            require(!isExecutive[exec], "Duplicate executive");

            isExecutive[exec] = true;
            executives.push(exec);
        }
    }

    // ─────────────────────────────────────────────────
    //  Deposit
    // ─────────────────────────────────────────────────

    /// @notice Anyone may deposit ETH into the treasury.
    receive() external payable {
        require(msg.value > 0, "Must send ETH");
        _recordDonation(msg.sender, msg.value);
        emit Deposited(msg.sender, msg.value);
    }

    function deposit() external payable {
        require(msg.value > 0, "Must send ETH");
        _recordDonation(msg.sender, msg.value);
        emit Deposited(msg.sender, msg.value);
    }

    /// @dev Adds a donor to the leaderboard on first deposit, then increments.
    function _recordDonation(address _donor, uint256 _amount) internal {
        if (!_isDonor[_donor]) {
            _isDonor[_donor] = true;
            _donors.push(_donor);
        }
        totalDonated[_donor] += _amount;
    }

    // ─────────────────────────────────────────────────
    //  Emergency Pause
    // ─────────────────────────────────────────────────

    /**
     * @notice Cast a vote to pause all treasury spending.
     *         When 2-of-3 executives vote, the contract is frozen.
     *         Use in case of a security incident or suspicious activity.
     */
    function votePause() external onlyExecutive {
        require(!paused, "Already paused");
        require(!hasPauseVoted[msg.sender], "Already voted to pause");

        hasPauseVoted[msg.sender] = true;
        pauseVoteCount += 1;

        emit PauseVoteCast(msg.sender, pauseVoteCount);

        if (pauseVoteCount >= REQUIRED_APPROVALS) {
            paused = true;
            emit ContractPaused();
        }
    }

    /**
     * @notice Cast a vote to unpause the treasury.
     *         When 2-of-3 executives vote, the contract resumes.
     */
    function voteUnpause() external onlyExecutive {
        require(paused, "Not paused");
        require(!hasUnpauseVoted[msg.sender], "Already voted to unpause");

        hasUnpauseVoted[msg.sender] = true;
        unpauseVoteCount += 1;

        emit UnpauseVoteCast(msg.sender, unpauseVoteCount);

        if (unpauseVoteCount >= REQUIRED_APPROVALS) {
            paused = false;
            // Reset both vote maps for next use
            _resetPauseVotes();
            emit ContractUnpaused();
        }
    }

    /// @dev Resets all pause/unpause vote state.
    function _resetPauseVotes() internal {
        for (uint256 i = 0; i < executives.length; i++) {
            hasPauseVoted[executives[i]]   = false;
            hasUnpauseVoted[executives[i]] = false;
        }
        pauseVoteCount   = 0;
        unpauseVoteCount = 0;
    }

    // ─────────────────────────────────────────────────
    //  Category Budget Caps
    // ─────────────────────────────────────────────────

    /**
     * @notice Set or update a spending cap for a category.
     *         A cap of 0 removes the limit (no cap).
     *         Any executive may call this — the cap is a soft governance tool.
     *
     * @param _category  Category name (e.g. "Events").
     * @param _cap       Maximum total ETH (in wei) that may be spent in this
     *                   category. Pass 0 to remove the cap.
     */
    function setCategoryBudget(string calldata _category, uint256 _cap)
        external
        onlyExecutive
    {
        categoryBudget[_categoryKey(_category)] = _cap;
        emit BudgetSet(_category, _cap);
    }

    /// @notice Returns the budget cap and amount spent for a category.
    function getCategoryInfo(string calldata _category)
        external
        view
        returns (uint256 cap, uint256 spent)
    {
        bytes32 key = _categoryKey(_category);
        return (categoryBudget[key], categorySpent[key]);
    }

    function _categoryKey(string memory _cat) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_cat));
    }

    // ─────────────────────────────────────────────────
    //  Core Multi-Sig — Spending Proposals
    // ─────────────────────────────────────────────────

    /**
     * @notice Propose a new spending transaction.
     *         The proposer's approval is counted automatically, so only
     *         one additional approval is required to reach quorum.
     *
     * @param _to          Recipient address.
     * @param _value       Amount (in wei) to send.
     * @param _description Human-readable purpose.
     * @param _category    Budget category (must match a known category string).
     * @return txIndex     Index of the new proposal.
     */
    function proposeTransaction(
        address _to,
        uint256 _value,
        string calldata _description,
        string calldata _category
    ) external onlyExecutive whenNotPaused returns (uint256 txIndex) {
        require(_to != address(0), "Invalid recipient");
        require(_value > 0, "Value must be > 0");
        require(_value <= address(this).balance, "Insufficient treasury balance");

        // Check category budget cap (if set)
        bytes32 key = _categoryKey(_category);
        uint256 cap = categoryBudget[key];
        if (cap > 0) {
            require(categorySpent[key] + _value <= cap, "Category budget exceeded");
        }

        txIndex = transactions.length;
        transactions.push(Transaction({
            to:            _to,
            value:         _value,
            description:   _description,
            category:      _category,
            executed:      false,
            cancelled:     false,
            approvalCount: 1,           // proposer auto-approved
            createdAt:     block.timestamp
        }));

        hasApproved[txIndex][msg.sender] = true;

        emit TransactionProposed(txIndex, msg.sender, _to, _value, _description, _category);
    }

    /**
     * @notice Approve a pending proposal. 2 total approvals unlock execution.
     */
    function approveTransaction(uint256 _txIndex)
        external
        onlyExecutive
        whenNotPaused
        txExists(_txIndex)
        notExecuted(_txIndex)
        notCancelled(_txIndex)
    {
        require(!hasApproved[_txIndex][msg.sender], "Already approved");

        hasApproved[_txIndex][msg.sender] = true;
        transactions[_txIndex].approvalCount += 1;

        emit TransactionApproved(_txIndex, msg.sender);
    }

    /**
     * @notice Revoke a previously given approval.
     */
    function revokeApproval(uint256 _txIndex)
        external
        onlyExecutive
        txExists(_txIndex)
        notExecuted(_txIndex)
        notCancelled(_txIndex)
    {
        require(hasApproved[_txIndex][msg.sender], "Not approved yet");

        hasApproved[_txIndex][msg.sender] = false;
        transactions[_txIndex].approvalCount -= 1;

        emit ApprovalRevoked(_txIndex, msg.sender);
    }

    /**
     * @notice Execute a proposal that has >= 2 approvals.
     *         Funds are transferred to the recipient immediately.
     */
    function executeTransaction(uint256 _txIndex)
        external
        onlyExecutive
        whenNotPaused
        txExists(_txIndex)
        notExecuted(_txIndex)
        notCancelled(_txIndex)
    {
        Transaction storage txn = transactions[_txIndex];
        require(txn.approvalCount >= REQUIRED_APPROVALS, "Not enough approvals");
        require(txn.value <= address(this).balance, "Insufficient balance");

        // Check category cap still satisfied at execution time
        bytes32 key = _categoryKey(txn.category);
        uint256 cap = categoryBudget[key];
        if (cap > 0) {
            require(categorySpent[key] + txn.value <= cap, "Category budget exceeded");
        }

        txn.executed = true;                             // re-entrancy guard
        categorySpent[key] += txn.value;                // track spending

        (bool success, ) = txn.to.call{value: txn.value}("");
        require(success, "Transfer failed");

        emit TransactionExecuted(_txIndex, msg.sender);
    }

    /**
     * @notice Cancel a proposal whose 7-day expiry window has elapsed.
     *         Any executive may call this. Cancelled proposals free up
     *         reserved budget and cannot be approved or re-executed.
     */
    function cancelExpiredTransaction(uint256 _txIndex)
        external
        onlyExecutive
        txExists(_txIndex)
        notExecuted(_txIndex)
        notCancelled(_txIndex)
    {
        require(
            block.timestamp > transactions[_txIndex].createdAt + EXPIRY_PERIOD,
            "Not expired yet"
        );
        transactions[_txIndex].cancelled = true;
        emit TransactionCancelled(_txIndex);
    }

    // ─────────────────────────────────────────────────
    //  Executive Replacement
    // ─────────────────────────────────────────────────

    /**
     * @notice Propose replacing an executive's wallet address.
     *         Use when a key is lost or leadership changes.
     *         Proposer is auto-approved; one more approval executes the swap.
     *
     * @param _oldExec  Current executive address to remove.
     * @param _newExec  New executive address to install.
     */
    function proposeReplacement(address _oldExec, address _newExec)
        external
        onlyExecutive
        returns (uint256 replIndex)
    {
        require(isExecutive[_oldExec],   "Old address is not an executive");
        require(!isExecutive[_newExec],  "New address is already an executive");
        require(_newExec != address(0),  "Zero address not allowed");

        replIndex = replacements.length;
        replacements.push(ExecReplacement({
            oldExec:      _oldExec,
            newExec:      _newExec,
            approvalCount: 1,
            executed:     false
        }));
        replacementApprovals[replIndex][msg.sender] = true;

        emit ReplacementProposed(replIndex, _oldExec, _newExec);
    }

    /// @notice Approve a pending executive replacement.
    function approveReplacement(uint256 _replIndex) external onlyExecutive {
        require(_replIndex < replacements.length, "Replacement does not exist");
        require(!replacements[_replIndex].executed, "Already executed");
        require(!replacementApprovals[_replIndex][msg.sender], "Already approved");

        replacementApprovals[_replIndex][msg.sender] = true;
        replacements[_replIndex].approvalCount += 1;

        emit ReplacementApproved(_replIndex, msg.sender);
    }

    /// @notice Execute an approved replacement (>= 2 approvals required).
    function executeReplacement(uint256 _replIndex) external onlyExecutive {
        require(_replIndex < replacements.length, "Replacement does not exist");
        ExecReplacement storage repl = replacements[_replIndex];
        require(!repl.executed, "Already executed");
        require(repl.approvalCount >= REQUIRED_APPROVALS, "Not enough approvals");

        address old      = repl.oldExec;
        address newExec  = repl.newExec;
        require(isExecutive[old],    "Old address is no longer an executive");
        require(!isExecutive[newExec], "New address is already an executive");

        repl.executed = true;

        for (uint256 i = 0; i < executives.length; i++) {
            if (executives[i] == old) {
                executives[i] = newExec;
                break;
            }
        }
        isExecutive[old]     = false;
        isExecutive[newExec] = true;

        emit ExecutiveReplaced(old, newExec);
    }

    // ─────────────────────────────────────────────────
    //  Executive Aliases
    // ─────────────────────────────────────────────────

    /**
     * @notice Set or update your own display alias shown in the DApp.
     *         Only the calling executive can set their own alias.
     *         Pass an empty string "" to clear the alias (revert to address display).
     *
     * @param _alias  Chosen display name, e.g. "Alice" or "President-K".
     */
    function setAlias(string calldata _alias) external onlyExecutive {
        executiveAlias[msg.sender] = _alias;
        emit AliasSet(msg.sender, _alias);
    }

    /**
     * @notice Returns the display name for an address if one is set,
     *         otherwise returns the address formatted as a string.
     *         Useful for frontends that want a single call for display.
     */
    function getAliasOrAddress(address _exec)
        external
        view
        returns (string memory)
    {
        string memory alias_ = executiveAlias[_exec];
        if (bytes(alias_).length > 0) {
            return alias_;
        }
        // Return the address as a hex string fallback
        return _toHexString(_exec);
    }

    /// @dev Converts an address to its "0x..." hex string representation.
    function _toHexString(address _addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes20 addrBytes = bytes20(_addr);
        bytes memory result = new bytes(42);
        result[0] = "0";
        result[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            result[2 + i * 2]     = alphabet[uint8(addrBytes[i] >> 4)];
            result[3 + i * 2]     = alphabet[uint8(addrBytes[i] & 0x0f)];
        }
        return string(result);
    }

    // ─────────────────────────────────────────────────
    //  View Helpers
    // ─────────────────────────────────────────────────

    /// @notice Returns the current treasury ETH balance.
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Returns total number of spending proposals (all states).
    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    /// @notice Returns the list of all 3 executive addresses.
    function getExecutives() external view returns (address[] memory) {
        return executives;
    }

    /// @notice Returns full details of a spending proposal.
    function getTransaction(uint256 _txIndex)
        external
        view
        txExists(_txIndex)
        returns (
            address to,
            uint256 value,
            string  memory description,
            string  memory category,
            bool    executed,
            bool    cancelled,
            uint256 approvalCount,
            uint256 createdAt
        )
    {
        Transaction storage txn = transactions[_txIndex];
        return (
            txn.to, txn.value, txn.description, txn.category,
            txn.executed, txn.cancelled, txn.approvalCount, txn.createdAt
        );
    }

    /// @notice Returns total number of replacement proposals.
    function getReplacementCount() external view returns (uint256) {
        return replacements.length;
    }

    /// @notice Returns details of a replacement proposal.
    function getReplacement(uint256 _replIndex)
        external
        view
        returns (
            address oldExec,
            address newExec,
            uint256 approvalCount,
            bool    executed
        )
    {
        require(_replIndex < replacements.length, "Replacement does not exist");
        ExecReplacement storage repl = replacements[_replIndex];
        return (repl.oldExec, repl.newExec, repl.approvalCount, repl.executed);
    }

    /// @notice Returns the number of unique donors.
    function getDonorCount() external view returns (uint256) {
        return _donors.length;
    }

    /// @notice Returns a donor's address and total ETH donated.
    function getDonor(uint256 _index)
        external
        view
        returns (address donor, uint256 amount)
    {
        require(_index < _donors.length, "Index out of range");
        donor  = _donors[_index];
        amount = totalDonated[donor];
    }
}
