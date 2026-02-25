import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ChainPOSModule = buildModule("ChainPOSModule", (m) => {
  // Using hardhat test accounts — replace with real addresses if needed
  const executor       = m.getParameter("executor",       "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  const platformWallet = m.getParameter("platformWallet", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  const taxWallet      = m.getParameter("taxWallet",      "0x90F79bf6EB2c4f870365E785982E1f101E93b906");
  const platformFeeBps = m.getParameter("platformFeeBps", 200n); // 2%
  const taxBps         = m.getParameter("taxBps",         300n); // 3%

  const chainPOS = m.contract("ChainPOS", [
    executor,
    platformWallet,
    taxWallet,
    platformFeeBps,
    taxBps,
  ]);

  return { chainPOS };
});

export default ChainPOSModule;