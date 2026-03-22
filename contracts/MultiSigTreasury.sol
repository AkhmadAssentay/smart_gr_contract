// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MultiSigTreasury
 * @notice A 2-of-3 multi-signature treasury for student club executives.
 *         Any spending proposal must be approved by at least 2 out of 3
 *         registered executives before funds can be released.
 *
 * @dev Light DAO flavor: executives can propose adding/removing members
 *      through the same multi-sig approval flow.
 */
contract MultiSigTreasury {
    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    uint256 public constant REQUIRED_APPROVALS = 2;
    uint256 public constant MAX_EXECUTIVES = 3;

    address[] public executives;
    mapping(address => bool) public isExecutive;

    struct Transaction {
        address to;
        uint256 value;
        string description;
        bool executed;
        uint256 approvalCount;
    }

    Transaction[] public transactions;

    // txIndex => executive address => has approved?
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event Deposited(address indexed sender, uint256 amount);
    event TransactionProposed(
        uint256 indexed txIndex,
        address indexed proposer,
        address to,
        uint256 value,
        string description
    );
    event TransactionApproved(uint256 indexed txIndex, address indexed approver);
    event ApprovalRevoked(uint256 indexed txIndex, address indexed revoker);
    event TransactionExecuted(uint256 indexed txIndex, address indexed executor);

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyExecutive() {
        require(isExecutive[msg.sender], "Not an executive");
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

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    /**
     * @param _executives Exactly 3 addresses that will control this treasury.
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

    // ──────────────────────────────────────────────
    //  Receive / Deposit
    // ──────────────────────────────────────────────

    /// @notice Anyone can deposit ETH into the treasury.
    receive() external payable {
        require(msg.value > 0, "Must send ETH");
        emit Deposited(msg.sender, msg.value);
    }

    function deposit() external payable {
        require(msg.value > 0, "Must send ETH");
        emit Deposited(msg.sender, msg.value);
    }

    // ──────────────────────────────────────────────
    //  Core Multi-Sig Logic
    // ──────────────────────────────────────────────

    /**
     * @notice Propose a new spending transaction.
     * @param _to        Recipient address.
     * @param _value     Amount of ETH (in wei) to send.
     * @param _description Human-readable reason for the spend.
     * @return txIndex   The index of the newly created transaction.
     */
    function proposeTransaction(
        address _to,
        uint256 _value,
        string calldata _description
    ) external onlyExecutive returns (uint256 txIndex) {
        require(_to != address(0), "Invalid recipient");
        require(_value > 0, "Value must be > 0");
        require(_value <= address(this).balance, "Insufficient treasury balance");

        txIndex = transactions.length;
        transactions.push(
            Transaction({
                to: _to,
                value: _value,
                description: _description,
                executed: false,
                approvalCount: 0
            })
        );

        emit TransactionProposed(txIndex, msg.sender, _to, _value, _description);
    }

    /**
     * @notice Approve a pending transaction. 2 approvals needed to execute.
     */
    function approveTransaction(uint256 _txIndex)
        external
        onlyExecutive
        txExists(_txIndex)
        notExecuted(_txIndex)
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
    {
        require(hasApproved[_txIndex][msg.sender], "Not approved yet");

        hasApproved[_txIndex][msg.sender] = false;
        transactions[_txIndex].approvalCount -= 1;

        emit ApprovalRevoked(_txIndex, msg.sender);
    }

    /**
     * @notice Execute a transaction once it has >= 2 approvals.
     */
    function executeTransaction(uint256 _txIndex)
        external
        onlyExecutive
        txExists(_txIndex)
        notExecuted(_txIndex)
    {
        Transaction storage txn = transactions[_txIndex];
        require(txn.approvalCount >= REQUIRED_APPROVALS, "Not enough approvals");
        require(txn.value <= address(this).balance, "Insufficient balance");

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}("");
        require(success, "Transfer failed");

        emit TransactionExecuted(_txIndex, msg.sender);
    }

    // ──────────────────────────────────────────────
    //  View Helpers
    // ──────────────────────────────────────────────

    /// @notice Returns the current treasury balance.
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Returns total number of transactions (pending + executed).
    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    /// @notice Returns the list of all executives.
    function getExecutives() external view returns (address[] memory) {
        return executives;
    }

    /// @notice Returns full details of a transaction.
    function getTransaction(uint256 _txIndex)
        external
        view
        txExists(_txIndex)
        returns (
            address to,
            uint256 value,
            string memory description,
            bool executed,
            uint256 approvalCount
        )
    {
        Transaction storage txn = transactions[_txIndex];
        return (txn.to, txn.value, txn.description, txn.executed, txn.approvalCount);
    }
}
