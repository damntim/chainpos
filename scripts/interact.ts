import hre from "hardhat";

async function main() {
  const connection = await hre.network.connect();
  const ethers = connection.ethers;

  const [owner, executor, platformWallet, taxWallet, vendor1, customer] =
    await ethers.getSigners();

  const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

  const ChainPOS = await ethers.getContractFactory("ChainPOS");
  const chainPOS = ChainPOS.attach(CONTRACT_ADDRESS);

  console.log("═══════════════════════════════════════════════");
  console.log("🛒  ChainPOS — Terminal Interaction Demo");
  console.log("═══════════════════════════════════════════════");

  // ── READ: initial state ──
  console.log("\n📖  READ OPERATIONS");
  console.log("───────────────────────────────────────────────");
  const balance = await chainPOS.getContractBalance();
  const vendorCount = await chainPOS.getVendorCount();
  const cycle = await chainPOS.currentCycle();
  const settled = await chainPOS.settlementExecuted();
  console.log(`💰  Contract Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log(`🏪  Vendor Count      : ${vendorCount}`);
  console.log(`🔄  Current Cycle     : ${cycle}`);
  console.log(`🔒  Settlement Done   : ${settled}`);

  // ── WRITE: register vendor ──
  console.log("\n🏪  STATE-CHANGING: REGISTER VENDOR");
  console.log("───────────────────────────────────────────────");
  const regTx = await chainPOS.connect(owner).registerVendor(vendor1.address, "Vendor One");
  await regTx.wait();
  console.log(`   ✔ Vendor registered | tx: ${regTx.hash.slice(0, 20)}...`);
  console.log(`   ✔ Is registered: ${await chainPOS.isVendorRegistered(vendor1.address)}`);

  // ── WRITE: vendor registers item ──
  console.log("\n📦  STATE-CHANGING: REGISTER ITEM");
  console.log("───────────────────────────────────────────────");
  const itemTx = await chainPOS.connect(vendor1).registerItem("ITEM-001", ethers.parseEther("0.1"));
  await itemTx.wait();
  console.log(`   ✔ Item registered | tx: ${itemTx.hash.slice(0, 20)}...`);
  const price = await chainPOS.getItemPrice(vendor1.address, "ITEM-001");
  console.log(`   ✔ Item price: ${ethers.formatEther(price)} ETH`);

  // ── WRITE: customer pays ──
  console.log("\n💳  STATE-CHANGING: CUSTOMER PAYMENT");
  console.log("───────────────────────────────────────────────");
  const payTx = await chainPOS.connect(customer).pay(vendor1.address, "ITEM-001", {
    value: ethers.parseEther("0.1"),
  });
  const payReceipt = await payTx.wait();
  console.log(`   ✔ Payment sent | tx: ${payTx.hash.slice(0, 20)}...`);

  // ── EVENTS: parse deposit ──
  console.log("\n📡  EVENTS EMITTED (Payment)");
  console.log("───────────────────────────────────────────────");
  for (const log of payReceipt.logs) {
    try {
      const parsed = chainPOS.interface.parseLog(log);
      if (parsed?.name === "Deposit") {
        console.log(`   📤 Deposit → vendor: ${parsed.args.vendor} | amount: ${ethers.formatEther(parsed.args.amount)} ETH`);
      }
    } catch {}
  }

  // ── READ: after payment ──
  console.log("\n📖  STATE AFTER PAYMENT");
  console.log("───────────────────────────────────────────────");
  console.log(`💰  Contract Balance  : ${ethers.formatEther(await chainPOS.getContractBalance())} ETH`);
  console.log(`🏪  Vendor1 Pending   : ${ethers.formatEther(await chainPOS.getVendorBalance(vendor1.address))} ETH`);
  console.log(`📋  Total Transactions: ${await chainPOS.getTransactionCount()}`);

  // ── WRITE: execute settlement ──
  console.log("\n⚡  STATE-CHANGING: EXECUTE SETTLEMENT");
  console.log("───────────────────────────────────────────────");
  const settleTx = await chainPOS.connect(executor).executeSettlement();
  const settleReceipt = await settleTx.wait();
  console.log(`   ✔ Settlement executed | tx: ${settleTx.hash.slice(0, 20)}...`);

  // ── EVENTS: parse settlement ──
  console.log("\n📡  EVENTS EMITTED (Settlement)");
  console.log("───────────────────────────────────────────────");
  for (const log of settleReceipt.logs) {
    try {
      const parsed = chainPOS.interface.parseLog(log);
      if (parsed?.name === "SettlementExecuted") {
        console.log(`   🎉 SettlementExecuted → cycle: ${parsed.args.cycle} | total: ${ethers.formatEther(parsed.args.totalAmount)} ETH`);
      }
    } catch {}
  }

  // ── READ: final state ──
  console.log("\n📖  FINAL STATE");
  console.log("───────────────────────────────────────────────");
  console.log(`💰  Contract Balance  : ${ethers.formatEther(await chainPOS.getContractBalance())} ETH`);
  console.log(`🔒  Settlement Done   : ${await chainPOS.settlementExecuted()}`);
  console.log("═══════════════════════════════════════════════");
  console.log("✅  Interaction demo complete!");
  console.log("═══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});