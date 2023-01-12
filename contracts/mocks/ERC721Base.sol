// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract ERC721Base is ERC721 {

    using Counters for Counters.Counter;
    Counters.Counter private _tokenId;

    constructor() ERC721('Test','Test') {}

    /// @dev Mints specified amount for user
    function mint(address user, uint256 amount) external {
        for (uint256 i=0; i<amount; ++i) {
            _mint(user, _tokenId.current());
            _tokenId.increment();
        }
    }

}