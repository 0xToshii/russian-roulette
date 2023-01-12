// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract ERC20Deflationary is ERC20 {

    constructor() ERC20('Test','Test') {}

    /// @dev Mints specified amount for user
    function mint(address user, uint256 amount) external {
        _mint(user, amount);
    }

    /// @dev transferFrom with a 5% transfer tax
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);

        uint256 tax = amount * 5 / 100;
        _burn(from, tax);

        _transfer(from, to, amount-tax);
        return true;
    }

    /// @dev transfer with a 5% transfer tax
    function transfer(
        address to, 
        uint256 amount
    ) public override returns (bool) {
        address owner = _msgSender();

        uint256 tax = amount * 5 / 100;
        _burn(owner, tax);

        _transfer(owner, to, amount-tax);
        return true;
    } 

}