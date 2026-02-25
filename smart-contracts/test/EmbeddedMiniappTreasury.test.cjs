const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EmbeddedMiniappTreasury", function () {
  it("accepts deposits and allows owner withdrawal", async function () {
    const [owner, alice, bob] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("EmbeddedMiniappTreasury");
    const treasury = await Treasury.deploy(owner.address);
    await treasury.waitForDeployment();

    // Alice deposits via function
    const matchId = ethers.keccak256(
      ethers.toUtf8Bytes("match-1")
    );

    await expect(
      treasury
        .connect(alice)
        .depositEntryFee(matchId, { value: ethers.parseEther("0.01") })
    ).to.emit(treasury, "EntryFeeReceived");

    // Bob sends ETH directly
    await bob.sendTransaction({
      to: await treasury.getAddress(),
      value: ethers.parseEther("0.02"),
    });

    expect(await treasury.balance()).to.equal(
      ethers.parseEther("0.03")
    );

    // Non-owner cannot withdraw
    await expect(
      treasury
        .connect(alice)
        .withdraw(alice.address, ethers.parseEther("0.01"))
    ).to.be.reverted;

    // Owner withdraws
    await expect(
      treasury
        .connect(owner)
        .withdraw(alice.address, ethers.parseEther("0.01"))
    ).to.emit(treasury, "TreasuryWithdrawal");

    expect(await treasury.balance()).to.equal(
      ethers.parseEther("0.02")
    );
  });
});