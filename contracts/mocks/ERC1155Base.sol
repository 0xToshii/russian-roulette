// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract ERC1155Base is ERC1155 {

    constructor() ERC1155('Test') {}

    /// @dev Mints specified amount for user
    function mint(address user, uint256 id, uint256 amount) external {
        _mint(user, id, amount, "");
    }

}