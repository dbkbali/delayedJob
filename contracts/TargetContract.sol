// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

contract TargetContract {
    uint256 public value;

    constructor(uint256 _value) {
        value = _value;
    }

    function testDj(uint256 _value) public {
        value = _value;
    }

    function getValue() public view returns (uint256) {
        return value;
    }
}
