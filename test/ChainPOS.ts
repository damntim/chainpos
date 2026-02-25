import { expect } from "chai";
import hre from "hardhat";

describe("ChainPOS", function () {
  async function deployFixture() {
    const connection = await hre.network.connect();
    const ethers = connection.ethers;

    const [owner, executor, platformWallet, taxWallet, vendor1, vendor2, customer] =
      await ethers.getSigners();

    const ChainPOS = await ethers.getContractFactory("ChainPOS");
    const chainPOS = await ChainPOS.deploy(
      executor.address,
      platformWallet.address,
      taxWallet.address,
      200n,  // 2% platform fee
      300n   // 3% tax
    );

    return { chainPOS, ethers, owner, executor, platformWallet, taxWallet, vendor1, vendor2, customer };
  }

  // ── Deployment ────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { chainPOS, owner } = await deployFixture();
      expect(await chainPOS.owner()).to.equal(owner.address);
    });

    it("Should set the correct executor", async function () {
      const { chainPOS, executor } = await deployFixture();
      expect(await chainPOS.executor()).to.equal(executor.address);
    });

    it("Should set correct platform and tax fees", async function () {
      const { chainPOS } = await deployFixture();
      expect(await chainPOS.platformFeeBps()).to.equal(200n);
      expect(await chainPOS.taxBps()).to.equal(300n);
    });

    it("Should start at cycle 1 with settlement not executed", async function () {
      const { chainPOS } = await deployFixture();
      expect(await chainPOS.currentCycle()).to.equal(1n);
      expect(await chainPOS.settlementExecuted()).to.equal(false);
    });
  });

  // ── Ownership Restrictions ────────────────────────────────────────
  describe("Ownership Restrictions", function () {
    it("Should allow owner to register a vendor", async function () {
      const { chainPOS, owner, vendor1 } = await deployFixture();
      await expect(chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One"))
        .to.emit(chainPOS, "VendorRegistered")
        .withArgs(vendor1.address, "Vendor One");
    });

    it("Should reject non-owner from registering a vendor", async function () {
      const { chainPOS, customer, vendor1 } = await deployFixture();
      await expect(
        chainPOS.connect(customer).registerVendor(vendor1.address, "Vendor One")
      ).to.be.revertedWith("ChainPOS: Not owner");
    });

    it("Should allow owner to change executor", async function () {
      const { chainPOS, owner, customer } = await deployFixture();
      await expect(chainPOS.connect(owner).setExecutor(customer.address))
        .to.emit(chainPOS, "ExecutorChanged");
    });

    it("Should reject non-owner from changing executor", async function () {
      const { chainPOS, customer, vendor1 } = await deployFixture();
      await expect(
        chainPOS.connect(customer).setExecutor(vendor1.address)
      ).to.be.revertedWith("ChainPOS: Not owner");
    });
  });

  // ── Role Authorization ────────────────────────────────────────────
  describe("Role Authorization", function () {
    it("Should allow executor to run settlement", async function () {
      const { chainPOS, owner, executor, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") });
      await expect(chainPOS.connect(executor).executeSettlement())
        .to.emit(chainPOS, "SettlementExecuted");
    });

    it("Should reject non-executor from running settlement", async function () {
      const { chainPOS, owner, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") });
      await expect(
        chainPOS.connect(customer).executeSettlement()
      ).to.be.revertedWith("ChainPOS: Not executor");
    });

    it("Should confirm isExecutor view function works correctly", async function () {
      const { chainPOS, executor, customer } = await deployFixture();
      expect(await chainPOS.isExecutor(executor.address)).to.equal(true);
      expect(await chainPOS.isExecutor(customer.address)).to.equal(false);
    });
  });

  // ── Vendor & Item Management ──────────────────────────────────────
  describe("Vendor and Item Management", function () {
    it("Should register a vendor and reflect in vendorList", async function () {
      const { chainPOS, owner, vendor1 } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      expect(await chainPOS.getVendorCount()).to.equal(1n);
      expect(await chainPOS.isVendorRegistered(vendor1.address)).to.equal(true);
    });

    it("Should reject duplicate vendor registration", async function () {
      const { chainPOS, owner, vendor1 } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await expect(
        chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One Again")
      ).to.be.revertedWith("Vendor already registered");
    });

    it("Should allow registered vendor to register an item", async function () {
      const { chainPOS, owner, vendor1, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await expect(
        chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"))
      ).to.emit(chainPOS, "ItemRegistered").withArgs(vendor1.address, "ITEM-001", ethers.parseEther("0.1"));
    });

    it("Should reject unregistered vendor from registering item", async function () {
      const { chainPOS, vendor1, ethers } = await deployFixture();
      await expect(
        chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"))
      ).to.be.revertedWith("ChainPOS: Not a registered vendor");
    });
  });

  // ── Fund Allocation Logic ─────────────────────────────────────────
  describe("Fund Allocation Logic", function () {
    it("Should accept correct payment and update vendor pending balance", async function () {
      const { chainPOS, owner, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") });
      expect(await chainPOS.getVendorBalance(vendor1.address)).to.equal(ethers.parseEther("0.1"));
    });

    it("Should reject incorrect payment amount", async function () {
      const { chainPOS, owner, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await expect(
        chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Incorrect payment amount");
    });

    it("Should distribute funds correctly after settlement", async function () {
      const { chainPOS, owner, executor, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("1.0"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("1.0") });
      await chainPOS.connect(executor).executeSettlement();
      expect(await chainPOS.getContractBalance()).to.equal(0n);
    });
  });

  // ── Execution Conditions ──────────────────────────────────────────
  describe("Execution Conditions", function () {
    it("Should reject settlement when contract balance is zero", async function () {
      const { chainPOS, executor } = await deployFixture();
      await expect(
        chainPOS.connect(executor).executeSettlement()
      ).to.be.revertedWith("Nothing to settle");
    });

    it("Should reject payment after settlement is executed", async function () {
      const { chainPOS, owner, executor, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") });
      await chainPOS.connect(executor).executeSettlement();
      await expect(
        chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("ChainPOS: Settlement already executed this cycle");
    });

    it("Should allow new cycle after owner resets", async function () {
      const { chainPOS, owner, executor, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") });
      await chainPOS.connect(executor).executeSettlement();
      await chainPOS.connect(owner).resetCycle();
      expect(await chainPOS.currentCycle()).to.equal(2n);
      expect(await chainPOS.settlementExecuted()).to.equal(false);
    });
  });

  // ── Double Execution Guard ────────────────────────────────────────
  describe("Double Execution Guard", function () {
    it("Should prevent settlement from running twice in same cycle", async function () {
      const { chainPOS, owner, executor, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") });
      await chainPOS.connect(executor).executeSettlement();
      await expect(
        chainPOS.connect(executor).executeSettlement()
      ).to.be.revertedWith("ChainPOS: Settlement already executed this cycle");
    });
  });

  // ── Event Emission ────────────────────────────────────────────────
  describe("Event Emission", function () {
    it("Should emit Deposit event on payment", async function () {
      const { chainPOS, owner, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await expect(
        chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") })
      ).to.emit(chainPOS, "Deposit").withArgs(customer.address, vendor1.address, "ITEM-001", ethers.parseEther("0.1"));
    });

    it("Should emit SettlementExecuted event on settlement", async function () {
      const { chainPOS, owner, executor, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") });
      await expect(chainPOS.connect(executor).executeSettlement())
        .to.emit(chainPOS, "SettlementExecuted");
    });

    it("Should emit VendorRegistered event", async function () {
      const { chainPOS, owner, vendor1 } = await deployFixture();
      await expect(chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One"))
        .to.emit(chainPOS, "VendorRegistered").withArgs(vendor1.address, "Vendor One");
    });
  });

  // ── View Functions ────────────────────────────────────────────────
  describe("View Functions", function () {
    it("Should return correct contract balance", async function () {
      const { chainPOS, owner, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.2"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.2") });
      expect(await chainPOS.getContractBalance()).to.equal(ethers.parseEther("0.2"));
    });

    it("Should return correct item price", async function () {
      const { chainPOS, owner, vendor1, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-A", ethers.parseEther("0.5"));
      expect(await chainPOS.getItemPrice(vendor1.address, "ITEM-A")).to.equal(ethers.parseEther("0.5"));
    });

    it("Should return correct transaction count", async function () {
      const { chainPOS, owner, vendor1, customer, ethers } = await deployFixture();
      await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
      await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
      await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", { value: ethers.parseEther("0.1") });
      expect(await chainPOS.getTransactionCount()).to.equal(1n);
    });
  });
});