import { expect } from "chai";
import { Contract, Signer, BigNumber } from "ethers";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const BN = BigNumber;
let precision = BN.from(10).pow(18);

// ERC777 are essentially a superset of ERC20 with hooks, which will not be able to callback the contract
// hence all tests of ERC777 are subsumed into the ERC20 tests - note: it is possible that the ERC777
// hook causes a revert in the chainlink VRF callback, this would be due to ~user error & so is not handled
// e.g. their hook reverts somehow or runs out of gas, this will result in a loss of funds and is on the user
describe('Testing ERC20-type tokens', function () {

  // gather users, deploy token and russian roulette contracts
  async function setup() {
    // gathering users
    let accounts = await ethers.getSigners();
    let [admin, user, user2] = accounts;

    // setting up chainlink VRF mock
    let vrfCoordinatorV2MockFactory = await ethers.getContractFactory('VRFCoordinatorMock')
    let vrfCoordinatorV2Mock = await vrfCoordinatorV2MockFactory.deploy(0,0)
    await vrfCoordinatorV2Mock.createSubscription()
    await vrfCoordinatorV2Mock.fundSubscription(1, precision.mul(10))

    // setting up russian roulette contract
    let russianRouletteFactory = await ethers.getContractFactory('RussianRoulette')
    let russianRoulette = await russianRouletteFactory.deploy(
      vrfCoordinatorV2Mock.address,ethers.constants.HashZero,1
    )

    await vrfCoordinatorV2Mock.addConsumer(1, russianRoulette.address)

    // setting up ERC20 tokens
    let erc20BaseFactory = await ethers.getContractFactory('ERC20Base')
    let erc20Base = await erc20BaseFactory.deploy()
    await erc20Base.mint(await user.getAddress(), precision.mul(1_000))
    await erc20Base.mint(await user2.getAddress(), precision.mul(1_000))
    await erc20Base.connect(user).approve(russianRoulette.address,precision.mul(1_000))
    await erc20Base.connect(user2).approve(russianRoulette.address,precision.mul(1_000))

    let erc20DeflationaryFactory = await ethers.getContractFactory('ERC20Deflationary')
    let erc20Deflationary = await erc20DeflationaryFactory.deploy()
    await erc20Deflationary.mint(await user.getAddress(), precision.mul(1_000))
    await erc20Deflationary.mint(await user2.getAddress(), precision.mul(1_000))
    await erc20Deflationary.connect(user).approve(russianRoulette.address,precision.mul(1_000))
    await erc20Deflationary.connect(user2).approve(russianRoulette.address,precision.mul(1_000))

    return { vrfCoordinatorV2Mock, russianRoulette, erc20Base, erc20Deflationary, user, user2 }
  }


  describe("Standard ERC20 Token", function () {

    it("Should allow users to pull when inputs are valid", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc20Base, erc20Deflationary, user, user2 } = await loadFixture(setup)

      await expect(russianRoulette.connect(user).pull(erc20Base.address,0,0)).to.be.reverted
      await expect(russianRoulette.connect(user).pull(ethers.constants.AddressZero,1,0)).to.be.reverted

      let tx = await russianRoulette.connect(user).pull(erc20Base.address,precision.mul(1_000),10)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await russianRoulette.connect(user).requests(requestId)).to.be.equal(await user.getAddress())

      expect(await erc20Base.balanceOf(russianRoulette.address)).to.be.equal(precision.mul(1_000))
      expect(await erc20Base.balanceOf(await user.getAddress())).to.be.equal(0)

      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['amount']).to.be.equal(precision.mul(1_000))
      expect(deposit['tokenId']).to.be.equal(0)
      expect(deposit['token']).to.be.equal(erc20Base.address)
      expect(deposit['entered']).to.be.equal(true)
      expect(deposit['tokenType']).to.be.equal(0) // TokenType.Token
    })

    it("Shouldn't allow users to pull until after first pull returns", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc20Base, erc20Deflationary, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc20Base.address,precision.mul(500),0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']

      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(true)

      await expect(russianRoulette.connect(user).pull(erc20Base.address,precision.mul(500),0)).to.be.reverted

      tx = await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, russianRoulette.address)
      receipt = await tx.wait()
      events = receipt.events.filter((x) => {return x.event == "RandomWordsFulfilled"})
      expect(events[0]['args']['success']).to.be.equal(true)

      deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false) // irrespective of result
    })

    it("Should allow user to receive funds back on a good roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc20Base, erc20Deflationary, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc20Base.address,precision.mul(1_000),0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc20Base.balanceOf(await user.getAddress())).to.be.equal(0)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 2) // fixed ran num

      expect(await erc20Base.balanceOf(await user.getAddress())).to.be.equal(precision.mul(1_000))
      expect(await erc20Base.balanceOf(russianRoulette.address)).to.be.equal(0)
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)      
    })

    it("Should result in user losing funds on a bad roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc20Base, erc20Deflationary, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc20Base.address,precision.mul(1_000),0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc20Base.balanceOf(await user.getAddress())).to.be.equal(0)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 6) // fixed ran num

      expect(await erc20Base.balanceOf(await user.getAddress())).to.be.equal(0)
      expect(await erc20Base.balanceOf(russianRoulette.address)).to.be.equal(precision.mul(1_000))
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)     
    })

    it("Should work when user does sequential rolls", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc20Base, erc20Deflationary, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc20Base.address,precision.mul(500),0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc20Base.balanceOf(await user.getAddress())).to.be.equal(precision.mul(500))

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 6) // fixed ran num

      tx = await russianRoulette.connect(user).pull(erc20Base.address,precision.mul(500),0)
      receipt = await tx.wait()
      events = receipt.events.filter((x) => {return x.event == "Pull"})
      requestId = events[0]['args']['requestId']

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 4) // fixed ran num

      expect(await erc20Base.balanceOf(await user.getAddress())).to.be.equal(precision.mul(500))
      expect(await erc20Base.balanceOf(russianRoulette.address)).to.be.equal(precision.mul(500))
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)
    })

    it("Should work when multiple users roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc20Base, erc20Deflationary, user, user2 } = await loadFixture(setup)

      await russianRoulette.connect(user).pull(erc20Base.address,precision.mul(500),0) // requestId=1
      await russianRoulette.connect(user2).pull(erc20Base.address,precision.mul(1_000),0) // requestId=2

      expect(await erc20Base.balanceOf(russianRoulette.address)).to.be.equal(precision.mul(1_500))

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(1, russianRoulette.address, 6) // user loses
      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(2, russianRoulette.address, 5) // user2 wins

      expect(await erc20Base.balanceOf(await user.getAddress())).to.be.equal(precision.mul(500))
      expect(await erc20Base.balanceOf(russianRoulette.address)).to.be.equal(precision.mul(500))
      expect(await erc20Base.balanceOf(await user2.getAddress())).to.be.equal(precision.mul(1_000))
    })

  })


  describe("Deflationary ERC20 Token", function () {

    it("Should correctly account for the actual deposited & returned amounts", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc20Base, erc20Deflationary, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc20Deflationary.address,precision.mul(1_000),0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc20Deflationary.balanceOf(await user.getAddress())).to.be.equal(0)
      expect(await erc20Deflationary.balanceOf(russianRoulette.address)).to.be.equal(precision.mul(950))

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 3) // fixed ran num

      expect(await erc20Deflationary.balanceOf(await user.getAddress())).to.be.equal(precision.div(10).mul(9025))
      expect(await erc20Deflationary.balanceOf(russianRoulette.address)).to.be.equal(0)
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)
    })

  })


})
