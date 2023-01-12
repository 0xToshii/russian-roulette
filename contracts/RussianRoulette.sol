// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";


/// @notice Implements russian roulette, allows inputs of arbitrary tokens
/// @notice There is a 1/6 prob that user will receive their deposited token(s) back
/// @dev Intended to handle ERC20, ERC777, ERC721 & ERC1155 tokens
/// @dev Only ERC721 and ERC1155 tokens which are ERC165 compliant are acceptable
/// @dev User should not expect other NFT contracts to be handled correctly
/// @dev IERC20 interface is used to interact with both ERC20 and ERC777 tokens
contract RussianRoulette is VRFConsumerBaseV2 {

    /// @notice Unique token types
    enum TokenType {Token, ERC721, ERC1155}

    /// @notice Stores information about user deposit during pull
    struct Deposit {
        uint256 amount;  // amount of `token` deposited
        uint256 tokenId; // id for ERC721, ERC1155
        address token;   // address of deposit token
        bool entered;    // if user has pulled
        TokenType tokenType;  // type of `token`
    }

    VRFCoordinatorV2Interface private vrfCoordinator;

    bytes32 immutable gasLane; // keyhash
    uint64 immutable subscriptionId;
    uint32 constant callbackGasLimit = 200_000;
    uint16 constant requestConfirmations = 3;
    uint32 constant numWords = 1;

    uint256 constant denom = 6; // 1/denom as odds of receiving token(s) back

    mapping(address => Deposit) public deposits;
    mapping(uint256 => address) public requests;

    event Pull(
        address indexed puller, 
        uint256 indexed requestId,
        address token, 
        uint256 amount,
        uint256 tokenId
    );
    event PullResult(
        address indexed puller,
        uint256 indexed requestId,
        uint256 roll
    );

    modifier isEOA() {
        require(tx.origin == msg.sender);
        _;
    }

    constructor(
        address _vrfCoordinatorV2, 
        bytes32 _gasLane, 
        uint64 _subscriptionId
    ) VRFConsumerBaseV2(_vrfCoordinatorV2) {
        vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinatorV2);
        gasLane = _gasLane;
        subscriptionId = _subscriptionId;
    }

    /// @dev Will only accept single tokenId transfers
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4) {
        return 0xf23a6e61;
    }

    /// @notice User deposits tokens to contract and chainlink VRF request is initiated
    /// @notice User is only allowed one pull at a time & must wait for completion
    /// @notice User is allowed to deposit ERC20, ERC777, ERC721 & ERC1155 tokens
    /// @dev Only EOA users are able to call this function, this also prevents reentrancy
    /// @dev Only ERC721 and ERC1155 tokens which are ERC165 compliant are acceptable,
    /// @dev this is deemed a reasonable tradeoff in terms of usability of arbitrary tokens
    /// @param _amount Amount of `_token` to transfer, must be > 0 for any token type
    /// @param _tokenId Id of `_token` to transfer, ignored for non-ERC721,ERC1155 tokens
    function pull(address _token, uint256 _amount, uint256 _tokenId) external isEOA {
        require(_amount > 0 && _token != address(0), 'invalid-inputs');
        require(deposits[msg.sender].entered == false, 'already-pulled');

        // determine if token is ERC721
        try IERC165(_token).supportsInterface(type(IERC721).interfaceId) returns (bool result) {
            if (result == true) {
                IERC721(_token).transferFrom(
                    msg.sender, 
                    address(this), 
                    _tokenId
                );
                requestRng(_token, 1, _tokenId, TokenType.ERC721);
                return;
            }
        } catch {}
        
        // determine if token is ERC1155
        try IERC165(_token).supportsInterface(type(IERC1155).interfaceId) returns (bool result) {
            if (result == true) {
                IERC1155(_token).safeTransferFrom(
                    msg.sender, 
                    address(this), 
                    _tokenId, 
                    _amount, 
                    ""
                );
                requestRng(_token, _amount, _tokenId, TokenType.ERC1155);
                return;
            }
        } catch {}
        
        // all non-ERC721,ERC1155 tokens are assumed to be ERC20 or ERC777
        IERC20 token = IERC20(_token);
        uint256 startBalance = token.balanceOf(address(this)); // handles deflationary tokens

        // generally safeTransferFrom is used for handling edge cases on transfer
        // not necessary here because we check the balance change after transfer anyways
        token.transferFrom(msg.sender, address(this), _amount);

        uint256 balanceChange = token.balanceOf(address(this))-startBalance;
        require(balanceChange > 0, 'nothing-deposited');
        
        requestRng(_token, balanceChange, 0, TokenType.Token);
    }

    /// @notice Callback for chainlink VRF requests
    /// @dev It's possible that the transfer reverts in certain edge cases and locks
    /// @dev the user out of calling pull(..) again, this is deemed acceptable
    /// @dev because this would only be the case with improperly configured tokens,
    /// @dev such as a hook for ERC777 that reverts or wastes tons of gas
    function fulfillRandomWords(
        uint256 requestId, 
        uint256[] memory randomWords
    ) internal override {
        address sender = requests[requestId]; // EOA
        uint256 roll = randomWords[0] % denom;

        if (roll != 0) { // receive funds back
            Deposit memory deposit = deposits[sender];

            if (deposit.tokenType == TokenType.ERC721) {
                IERC721(deposit.token).transferFrom(
                    address(this), 
                    sender, 
                    deposit.tokenId
                );
            } else if (deposit.tokenType == TokenType.ERC1155) {
                IERC1155(deposit.token).safeTransferFrom(
                    address(this), 
                    sender, 
                    deposit.tokenId, 
                    deposit.amount, 
                    ""
                );
            } else { // standard Token type
                // this could revert if e.g. the user used an ERC721 contract not conforming to
                // ERC165 and `amount` param being mistaken for tokenId, in this case the balance 
                // change stored for the user might not be equal to `amount` thus a transfer
                // call will fail, this is also a potential security concern, but as mentioned
                // before this is deemed `on the user` for using a non-compliant ERC721 token
                IERC20(deposit.token).transfer(
                    sender, 
                    deposit.amount
                );
            }
        }

        // can save gas by not zero-ing out all vars
        delete deposits[sender]; // entered = false

        emit PullResult(sender, requestId, roll);
    }

    /// @dev Requests random number from chainlink VRF
    function requestRng(
        address _token, 
        uint256 _amount, 
        uint256 _tokenId, 
        TokenType _tokenType
    ) private {
        Deposit memory userDeposit = Deposit(
            _amount, 
            _tokenId, 
            _token, 
            true, // entered
            _tokenType
        );
        deposits[msg.sender] = userDeposit;

        uint256 requestId = vrfCoordinator.requestRandomWords(
            gasLane,
            subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            numWords
        );
        requests[requestId] = msg.sender;

        emit Pull(msg.sender, requestId, _token, _amount, _tokenId);
    }

}