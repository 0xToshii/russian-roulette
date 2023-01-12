// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Base is ERC20 {

    constructor() ERC20('Test','Test') {}

    /// @dev Mints specified amount for user
    function mint(address user, uint256 amount) external {
        _mint(user, amount);
    }

}