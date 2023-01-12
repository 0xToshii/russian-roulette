// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@chainlink/contracts/src/v0.8/mocks/VRFCoordinatorV2Mock.sol";


contract VRFCoordinatorMock is VRFCoordinatorV2Mock {

    constructor(
        uint96 _baseFee, 
        uint96 _gasPriceLink
    ) VRFCoordinatorV2Mock(_baseFee, _gasPriceLink) {}
  
    /// @dev Additional mock function to force a specific random number
    function fulfillRandomWordsFixed(
        uint256 _requestId, 
        address _consumer, 
        uint256 ranNumber
    ) external {
        fulfillRandomWordsWithOverrideFixed(_requestId, _consumer, new uint256[](0), ranNumber);
    }

    function fulfillRandomWordsWithOverrideFixed(
        uint256 _requestId,
        address _consumer,
        uint256[] memory _words,
        uint256 ranNumber // set as all random numbers requested
    ) public {
        uint256 startGas = gasleft();
        if (s_requests[_requestId].subId == 0) {
            revert("nonexistent request");
        }
        Request memory req = s_requests[_requestId];

        if (_words.length == 0) {
            _words = new uint256[](req.numWords);
            for (uint256 i = 0; i < req.numWords; i++) {
                _words[i] = ranNumber;
            }
        } else if (_words.length != req.numWords) {
            revert InvalidRandomWords();
        }

        VRFConsumerBaseV2 v;
        bytes memory callReq = abi.encodeWithSelector(v.rawFulfillRandomWords.selector, _requestId, _words);
        (bool success, ) = _consumer.call{gas: req.callbackGasLimit}(callReq);

        uint96 payment = uint96(BASE_FEE + ((startGas - gasleft()) * GAS_PRICE_LINK));
        if (s_subscriptions[req.subId].balance < payment) {
            revert InsufficientBalance();
        }
        s_subscriptions[req.subId].balance -= payment;
        delete (s_requests[_requestId]);
        emit RandomWordsFulfilled(_requestId, _requestId, payment, success);
    }

}