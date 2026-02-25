// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ChainPOS
 * @notice Decentralized point-of-sale system for multi-vendor markets
 */
contract ChainPOS {

    // ── State Variables ──────────────────────────────────────────────
    address public owner;
    address public executor;
    address public platformWallet;
    address public taxWallet;

    uint256 public platformFeeBps;
    uint256 public taxBps;

    bool public settlementExecuted;
    uint256 public currentCycle;

    // ── Data Structures ──────────────────────────────────────────────
    struct Vendor {
        address wallet;
        string name;
        bool registered;
        uint256 pendingBalance;
    }

    struct Transaction {
        address vendor;
        string itemRef;
        uint256 amount;
        uint256 timestamp;
    }

    mapping(address => Vendor) public vendors;
    mapping(address => mapping(string => uint256)) public itemPrices;

    address[] public vendorList;
    Transaction[] public transactions;

    // ── Events ───────────────────────────────────────────────────────
    event VendorRegistered(address indexed vendor, string name);
    event VendorRemoved(address indexed vendor);
    event ItemRegistered(address indexed vendor, string itemRef, uint256 price);
    event Deposit(address indexed customer, address indexed vendor, string itemRef, uint256 amount);
    event SettlementExecuted(uint256 cycle, uint256 totalAmount);
    event ExecutorChanged(address indexed oldExecutor, address indexed newExecutor);

    // ── Modifiers ────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "ChainPOS: Not owner");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "ChainPOS: Not executor");
        _;
    }

    modifier onlyRegisteredVendor() {
        require(vendors[msg.sender].registered, "ChainPOS: Not a registered vendor");
        _;
    }

    modifier settlementNotExecuted() {
        require(!settlementExecuted, "ChainPOS: Settlement already executed this cycle");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────
    constructor(
        address _executor,
        address _platformWallet,
        address _taxWallet,
        uint256 _platformFeeBps,
        uint256 _taxBps
    ) {
        require(_executor != address(0), "Invalid executor");
        require(_platformWallet != address(0), "Invalid platform wallet");
        require(_taxWallet != address(0), "Invalid tax wallet");
        require(_platformFeeBps + _taxBps < 10000, "Fees exceed 100%");

        owner = msg.sender;
        executor = _executor;
        platformWallet = _platformWallet;
        taxWallet = _taxWallet;
        platformFeeBps = _platformFeeBps;
        taxBps = _taxBps;
        currentCycle = 1;
    }

    // ── Owner Functions ──────────────────────────────────────────────
    function registerVendor(address _vendor, string calldata _name) external onlyOwner {
        require(_vendor != address(0), "Invalid vendor address");
        require(!vendors[_vendor].registered, "Vendor already registered");

        vendors[_vendor] = Vendor({
            wallet: _vendor,
            name: _name,
            registered: true,
            pendingBalance: 0
        });
        vendorList.push(_vendor);

        emit VendorRegistered(_vendor, _name);
    }

    function removeVendor(address _vendor) external onlyOwner {
        require(vendors[_vendor].registered, "Vendor not registered");
        require(vendors[_vendor].pendingBalance == 0, "Vendor has pending balance");

        vendors[_vendor].registered = false;
        emit VendorRemoved(_vendor);
    }

    function setExecutor(address _newExecutor) external onlyOwner {
        require(_newExecutor != address(0), "Invalid executor");
        address old = executor;
        executor = _newExecutor;
        emit ExecutorChanged(old, _newExecutor);
    }

    // ── Vendor Functions ─────────────────────────────────────────────
    function registerItem(string calldata _itemRef, uint256 _price) external onlyRegisteredVendor {
        require(_price > 0, "Price must be greater than zero");
        itemPrices[msg.sender][_itemRef] = _price;
        emit ItemRegistered(msg.sender, _itemRef, _price);
    }

    // ── Payment Function ─────────────────────────────────────────────
    function pay(address _vendor, string calldata _itemRef) external payable settlementNotExecuted {
        require(vendors[_vendor].registered, "Vendor not registered");
        uint256 price = itemPrices[_vendor][_itemRef];
        require(price > 0, "Item not found");
        require(msg.value == price, "Incorrect payment amount");

        vendors[_vendor].pendingBalance += msg.value;

        transactions.push(Transaction({
            vendor: _vendor,
            itemRef: _itemRef,
            amount: msg.value,
            timestamp: block.timestamp
        }));

        emit Deposit(msg.sender, _vendor, _itemRef, msg.value);
    }

    // ── Settlement Function ──────────────────────────────────────────
    function executeSettlement() external onlyExecutor settlementNotExecuted {
        uint256 total = address(this).balance;
        require(total > 0, "Nothing to settle");

        uint256 platformCut = (total * platformFeeBps) / 10000;
        uint256 taxCut = (total * taxBps) / 10000;
        uint256 vendorPool = total - platformCut - taxCut;

        // Pay platform and tax
        (bool p,) = platformWallet.call{value: platformCut}("");
        require(p, "Platform transfer failed");

        (bool t,) = taxWallet.call{value: taxCut}("");
        require(t, "Tax transfer failed");

        // Distribute to vendors proportionally
        uint256 distributed = 0;
        for (uint256 i = 0; i < vendorList.length; i++) {
            address v = vendorList[i];
            if (vendors[v].pendingBalance > 0) {
                uint256 share = (vendors[v].pendingBalance * vendorPool) / total;
                vendors[v].pendingBalance = 0;
                distributed += share;
                (bool s,) = v.call{value: share}("");
                require(s, "Vendor transfer failed");
            }
        }

        settlementExecuted = true;
        emit SettlementExecuted(currentCycle, total);
    }

    // ── Cycle Reset (Owner only) ─────────────────────────────────────
    function resetCycle() external onlyOwner {
        require(settlementExecuted, "Current cycle not yet settled");
        settlementExecuted = false;
        currentCycle += 1;
    }

    // ── View Functions ───────────────────────────────────────────────
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getVendorBalance(address _vendor) external view returns (uint256) {
        return vendors[_vendor].pendingBalance;
    }

    function getVendorCount() external view returns (uint256) {
        return vendorList.length;
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getItemPrice(address _vendor, string calldata _itemRef) external view returns (uint256) {
        return itemPrices[_vendor][_itemRef];
    }

    function isVendorRegistered(address _vendor) external view returns (bool) {
        return vendors[_vendor].registered;
    }

    function isExecutor(address _addr) external view returns (bool) {
        return _addr == executor;
    }

    // ── Fallback ─────────────────────────────────────────────────────
    receive() external payable {
        revert("Use pay() function");
    }
}