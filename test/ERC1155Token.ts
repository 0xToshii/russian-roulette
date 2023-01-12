import { expect } from "chai";
import { Contract, Signer, BigNumber } from "ethers";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const BN = BigNumber;
let precision = BN.from(10).pow(18);

// ERC1155 tokens are expected to follow ERC165 standard, else behavior is not guaranteed
// Only one tokenId can be gambled at a time, e.g. no `safeBatchTransferFrom` support
describe('Testing ERC1155 tokens', function () {

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

    // setting up ERC1155 tokens
    let erc1155BaseFactory = await ethers.getContractFactory('ERC1155Base')
    let erc1155Base = await erc1155BaseFactory.deploy()
    await erc1155Base.mint(await user.getAddress(), 0, 1_000)
    await erc1155Base.mint(await user.getAddress(), 1, 1_000)
    await erc1155Base.mint(await user2.getAddress(), 0, 500)
    await erc1155Base.connect(user).setApprovalForAll(russianRoulette.address,true)
    await erc1155Base.connect(user2).setApprovalForAll(russianRoulette.address,true)

    return { vrfCoordinatorV2Mock, russianRoulette, erc1155Base, user, user2 }
  }


  describe("Standard ERC1155 Token", function () {

    it("Should allow users to pull when inputs are valid", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc1155Base, user, user2 } = await loadFixture(setup)

      // ERC20 tests already check whether pull will accept invalid inputs

      let tx = await russianRoulette.connect(user).pull(erc1155Base.address,100,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await russianRoulette.connect(user).requests(requestId)).to.be.equal(await user.getAddress())

      expect(await erc1155Base.balanceOf(russianRoulette.address,0)).to.be.equal(100)

      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['amount']).to.be.equal(100)
      expect(deposit['tokenId']).to.be.equal(0)
      expect(deposit['token']).to.be.equal(erc1155Base.address)
      expect(deposit['entered']).to.be.equal(true)
      expect(deposit['tokenType']).to.be.equal(2) // TokenType.Token
    })

    it("Shouldn't allow users to pull until after first pull returns", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc1155Base, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc1155Base.address,100,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']

      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(true)

      await expect(russianRoulette.connect(user).pull(erc1155Base.address,200,0)).to.be.reverted
      await expect(russianRoulette.connect(user).pull(erc1155Base.address,200,1)).to.be.reverted

      tx = await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, russianRoulette.address)
      receipt = await tx.wait()
      events = receipt.events.filter((x) => {return x.event == "RandomWordsFulfilled"})
      expect(events[0]['args']['success']).to.be.equal(true)

      deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false) // irrespective of result
    })

    it("Should allow user to receive token back on a good roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc1155Base, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc1155Base.address,500,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc1155Base.balanceOf(russianRoulette.address,0)).to.be.equal(500)
      expect(await erc1155Base.balanceOf(await user.getAddress(),0)).to.be.equal(500)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 3) // fixed ran num

      expect(await erc1155Base.balanceOf(russianRoulette.address,0)).to.be.equal(0)
      expect(await erc1155Base.balanceOf(await user.getAddress(),0)).to.be.equal(1_000)     
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)
    })

    it("Should result in user losing token on a bad roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc1155Base, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc1155Base.address,200,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc1155Base.balanceOf(russianRoulette.address,0)).to.be.equal(200)
      expect(await erc1155Base.balanceOf(await user.getAddress(),0)).to.be.equal(800)
      
      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 6) // fixed ran num

      expect(await erc1155Base.balanceOf(russianRoulette.address,0)).to.be.equal(200)
      expect(await erc1155Base.balanceOf(await user.getAddress(),0)).to.be.equal(800)
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)
    })

    it("Should work when user does sequential rolls", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc1155Base, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc1155Base.address,200,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc1155Base.balanceOf(russianRoulette.address,0)).to.be.equal(200)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 6) // fixed ran num
      expect(await erc1155Base.balanceOf(await user.getAddress(),0)).to.be.equal(800)

      tx = await russianRoulette.connect(user).pull(erc1155Base.address,500,1)
      receipt = await tx.wait()
      events = receipt.events.filter((x) => {return x.event == "Pull"})
      requestId = events[0]['args']['requestId']
      expect(await erc1155Base.balanceOf(russianRoulette.address,1)).to.be.equal(500)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 1) // fixed ran num

      expect(await erc1155Base.balanceOf(russianRoulette.address,1)).to.be.equal(0)
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)
    })

    it("Should work when multiple users roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc1155Base, user, user2 } = await loadFixture(setup)

      await russianRoulette.connect(user).pull(erc1155Base.address,100,0) // requestId=1
      await russianRoulette.connect(user2).pull(erc1155Base.address,150,0) // requestId=2

      expect(await erc1155Base.balanceOf(russianRoulette.address,0)).to.be.equal(250)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(1, russianRoulette.address, 6) // user loses
      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(2, russianRoulette.address, 2) // user2 wins

      expect(await erc1155Base.balanceOf(russianRoulette.address,0)).to.be.equal(100)
      expect(await erc1155Base.balanceOf(await user.getAddress(),0)).to.be.equal(900)
      expect(await erc1155Base.balanceOf(await user2.getAddress(),0)).to.be.equal(500)
    })

  })


})
