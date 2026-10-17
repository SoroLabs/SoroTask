pragma circom 2.1.6;

include "poseidon.circom";

template PoseidonMembershipProof(height) {
    signal input leaf;
    signal input pathElements[height];
    signal input pathIndices[height];
    signal input root;

    signal intermediate[height + 1];
    intermediate[0] <== leaf;

    component hashers[height];
    for (var level = 0; level < height; level++) {
        pathIndices[level] * (pathIndices[level] - 1) === 0;
        hashers[level] = Poseidon(2);
        hashers[level].inputs[0] <== intermediate[level] * (1 - pathIndices[level]) + pathElements[level] * pathIndices[level];
        hashers[level].inputs[1] <== intermediate[level] * pathIndices[level] + pathElements[level] * (1 - pathIndices[level]);
        intermediate[level + 1] <== hashers[level].out;
    }

    intermediate[height] === root;
}

component main { public [root] } = PoseidonMembershipProof(20);
