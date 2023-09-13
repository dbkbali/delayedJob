# DelayedJob

## Description

This project contains 2 contracts for delayed jobs the specs for each of these smart contracts are detailed below:

### DelayedJob.sol

1. User A will submit a job (a contract address + a method to call) that should be called after a customizable delay and also include an Eth reward
2. User B can execute the job after the required delay and receive the Eth reward
3. User A can submit multiple jobs

### DelayedJobBid.sol

This contract extends the DelayedJob contract and adds the following functionality:

1. Instead of User A setting a fixed reward for his job, he specifies a maximum reward
2. User B and other users can bid to compete for who can complete the job for the smallest
reward
a. Bids can be submitted until the delay has elapsed
b. Once the delay has elapsed, the lowest bid wins and can execute the job at this
price
c. To place a bid, User B needs to deposit collateral equal to the difference between
the maximum reward and their bid
d. When a lower bid is placed, the previous bid is refunded to the previous bidder
3. User A also sets a timeout on his job with a minimum duration of 1 hour after the delay has elapsed. If the winning bidder does not execute the job within this timeout, User A can cancel the job and claim the collateral the bidder forfeited.
4. If User B is the lowest bidder and executes the job, User A is refunded the difference in the max bid and the execution bid reward, and User B receives the reward and is refunded his collateral.
5. If there are no lower bids than the maximum reward the job cannot be executed

## Prerequisites
- Node.js ^v18.6.0

## Installation & Setup
- run yarn install

## Testing 

- to run tests see gas report and coverage report run the following commands:
```shell
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat coverage
```

## Notes

- Whilst these tests are written in typescript using the hardhat testing environment - significant speedup in testing time could be had by writing tests using the Foundry testing environment - this would also allow for fuzz testing which is something I would probably do in the event these contracts are to be audited
- I have made the assumption that once jobs are executed and or canceled they are deleted from the jobs mapping - under the assumption that the events will leave an adequate audit trail. Not sure whether there would be any benefit from emitting an event on deletion for transparency purposes - but this would be contingent on the UX you want to present to users.

## GAS Optimization
- couldnt resist tweaking with gas optimization as a learning exercise so focused on optimizing the Job Struct

    experiment 1: reorder so addresses first
    result: gas cancelJob: 56585 => 56585
            gas execute:   73230 => 73230
            gas placeBid:  77271 => 59596
            gas queueJob:  150490 => 170390
        
    experiment 2: try with uint128 for bid and reward values (incremental)
    result: gas cancelJob: 56585 => 52976
            gas execute:   73230 => 70018
            gas placeBid:  59596 => 60042
            gas queueJob:  150490 => 148739

    experiment 3: try with uint64 for bid and reward values (assumes max Reward (2^64 - 1)/10^18 = 18.4 ether - is this the maximum Reward that we would ever set?) -incremental over 2 above
    result: gas cancelJob: 52976 => 49212
            gas execute:   70018 => 66320
            gas placeBid:  60042 => 58165
            gas queueJob:  150490 => 126888

    ### Conclusion
    - more experimentation possible - for example using assembly to save the struct could result in even more gas saving (but at the expense of complexity)!
    - Depending on the Max Reward ever expected for an auction uint64 is enough to cover a reward of 18.4 ether! - may want to add some protections against overflows etc ..


