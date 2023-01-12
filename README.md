# Russian Roulette

Spec:
- support arbitrary tokens (ERC20, ERC777)
- support arbitrary NFTs (ERC721, ERC1155)
- user calls "pull" and sends token(s) to the RussianRoulette contract
- uses chainlink VRF to roll a random number between 1 and 6
- if the number is 6, burn the token(s)
- if the number is not 6, send the token(s) back to the user
- permissionless contract with no owner functions
