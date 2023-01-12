import { expect } from "chai";
import { Contract, Signer, BigNumber } from "ethers";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const BN = BigNumber;
let precision = BN.from(10).pow(18);

// ERC721 tokens are expected to follow ERC165 standard, else behavior is not guaranteed
describe('Testing ERC721 tokens', function () {

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

    // setting up ERC721 tokens
    let erc721BaseFactory = await ethers.getContractFactory('ERC721Base')
    let erc721Base = await erc721BaseFactory.deploy()
    await erc721Base.mint(await user.getAddress(), 2) // starts at index=0
    await erc721Base.mint(await user2.getAddress(), 1)
    await erc721Base.connect(user).approve(russianRoulette.address,0)
    await erc721Base.connect(user).approve(russianRoulette.address,1)
    await erc721Base.connect(user2).approve(russianRoulette.address,2)

    return { vrfCoordinatorV2Mock, russianRoulette, erc721Base, user, user2 }
  }


  describe("Standard ERC721 Token", function () {

    it("Should allow users to pull when inputs are valid", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc721Base, user, user2 } = await loadFixture(setup)

      // ERC20 tests already check whether pull will accept invalid inputs

      let tx = await russianRoulette.connect(user).pull(erc721Base.address,101,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await russianRoulette.connect(user).requests(requestId)).to.be.equal(await user.getAddress())

      expect(await erc721Base.ownerOf(0)).to.be.equal(russianRoulette.address)

      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['amount']).to.be.equal(1)
      expect(deposit['tokenId']).to.be.equal(0)
      expect(deposit['token']).to.be.equal(erc721Base.address)
      expect(deposit['entered']).to.be.equal(true)
      expect(deposit['tokenType']).to.be.equal(1) // TokenType.Token
    })

    it("Shouldn't allow users to pull until after first pull returns", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc721Base, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc721Base.address,1,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']

      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(true)

      await expect(russianRoulette.connect(user).pull(erc721Base.address,1,1)).to.be.reverted

      tx = await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, russianRoulette.address)
      receipt = await tx.wait()
      events = receipt.events.filter((x) => {return x.event == "RandomWordsFulfilled"})
      expect(events[0]['args']['success']).to.be.equal(true)

      deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false) // irrespective of result
    })

    it("Should allow user to receive token back on a good roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc721Base, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc721Base.address,1,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc721Base.ownerOf(0)).to.be.equal(russianRoulette.address)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 2) // fixed ran num

      expect(await erc721Base.ownerOf(0)).to.be.equal(await user.getAddress())      
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)
    })

    it("Should result in user losing token on a bad roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc721Base, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc721Base.address,1,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc721Base.ownerOf(0)).to.be.equal(russianRoulette.address)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 6) // fixed ran num

      expect(await erc721Base.ownerOf(0)).to.be.equal(russianRoulette.address)
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)
    })

    it("Should work when user does sequential rolls", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc721Base, user, user2 } = await loadFixture(setup)

      let tx = await russianRoulette.connect(user).pull(erc721Base.address,1,0)
      let receipt = await tx.wait()
      let events = receipt.events.filter((x) => {return x.event == "Pull"})
      let requestId = events[0]['args']['requestId']
      expect(await erc721Base.ownerOf(0)).to.be.equal(russianRoulette.address)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 6) // fixed ran num
      expect(await erc721Base.ownerOf(0)).to.be.equal(russianRoulette.address)

      tx = await russianRoulette.connect(user).pull(erc721Base.address,1,1)
      receipt = await tx.wait()
      events = receipt.events.filter((x) => {return x.event == "Pull"})
      requestId = events[0]['args']['requestId']
      expect(await erc721Base.ownerOf(1)).to.be.equal(russianRoulette.address)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(requestId, russianRoulette.address, 5) // fixed ran num

      expect(await erc721Base.ownerOf(1)).to.be.equal(await user.getAddress())      
      let deposit = await russianRoulette.connect(user).deposits(await user.getAddress())
      expect(deposit['entered']).to.be.equal(false)
    })

    it("Should work when multiple users roll", async () => {
      let { vrfCoordinatorV2Mock, russianRoulette, erc721Base, user, user2 } = await loadFixture(setup)

      await russianRoulette.connect(user).pull(erc721Base.address,1,0) // requestId=1
      await russianRoulette.connect(user2).pull(erc721Base.address,1,2) // requestId=2

      expect(await erc721Base.balanceOf(russianRoulette.address)).to.be.equal(2)

      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(1, russianRoulette.address, 6) // user loses
      await vrfCoordinatorV2Mock.fulfillRandomWordsFixed(2, russianRoulette.address, 4) // user2 wins

      expect(await erc721Base.ownerOf(0)).to.be.equal(russianRoulette.address)
      expect(await erc721Base.ownerOf(2)).to.be.equal(await user2.getAddress())
    })

  })


})
