pragma circom 2.1.6;

include "comparators.circom";

template RangeProof() {
    signal input secretValue;
    signal input minValue;
    signal input maxValue;

    component belowMinimum = LessThan(64);
    belowMinimum.in[0] <== secretValue;
    belowMinimum.in[1] <== minValue;
    belowMinimum.out === 0;

    component aboveMaximum = LessThan(64);
    aboveMaximum.in[0] <== maxValue;
    aboveMaximum.in[1] <== secretValue;
    aboveMaximum.out === 0;
}

component main { public [minValue, maxValue] } = RangeProof();
