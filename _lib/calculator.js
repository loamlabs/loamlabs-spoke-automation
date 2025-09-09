// File: /_lib/calculator.js

/**
--- NEW ---
Calculates the Berd-specific correction factors and returns the final length.
@returns {number} The final Berd length (pre-rounding).
*/
export function calculateBerdFinalLength(metalLength, hubType, isLeft, { flangeL, flangeR, metalLengthL, metalLengthR }) {
    let hubConstant = 0.0;
    switch(hubType) {
        case 'Classic Flange': hubConstant = 9.0; break;
        case 'Straight Pull':  hubConstant = 7.5; break;
        case 'Hook Flange':    hubConstant = 2.0; break;
    }

    const angleLeft = flangeL / metalLengthL;
    const angleRight = flangeR / metalLengthR;
    let tensionPercent = (angleLeft < angleRight) ? (isLeft ? 100 : (angleLeft / angleRight * 100)) : (isLeft ? (angleRight / angleLeft * 100) : 100);
    
    const L = 2.5;
    const tensionComp = 0.000444 * Math.pow(tensionPercent, 2) - 0.1231 * tensionPercent + L;
    
    let lengthAdder = 0.0;
    if (metalLength < 200.0) lengthAdder = 4.0;
    else if (metalLength < 220.0) lengthAdder = 3.0;
    else if (metalLength < 240.0) lengthAdder = 2.0;
    else if (metalLength < 260.0) lengthAdder = 1.0;

    return metalLength + hubConstant + tensionComp + lengthAdder;
}


// --- Core Calculation Functions from your internal calculator file ---
export function applyRounding(length, vendor) {
    if (vendor === 'Berd') {
        return Math.round(length) - 2;
    }
    return Math.ceil(length / 2) * 2;
}

export function calculateElongation(spokeLength, tensionKgf, crossSectionalArea) {
    if (!crossSectionalArea || crossSectionalArea === 0) return 0;
    const YOUNG_MODULUS_STEEL_GPA = 210;
    const tensionN = tensionKgf * 9.80665;
    const modulusPa = YOUNG_MODULUS_STEEL_GPA * 1e9;
    const elongationMeters = (tensionN * (spokeLength / 1000)) / (modulusPa * (crossSectionalArea / 1e6));
    return elongationMeters * 1000;
}

export function calculateSpokeLength(params) {
    const { isLeft, hubType, baseCrossPattern, spokeCount, finalErd, hubFlangeDiameter, flangeOffset, spOffset, hubSpokeHoleDiameter } = params;
    let effectiveCrossPattern = baseCrossPattern;
    if (hubType === 'Straight Pull' && baseCrossPattern > 0) {
        effectiveCrossPattern += 0.5;
    }
    const angle = (2 * Math.PI * effectiveCrossPattern) / (spokeCount / 2);
    const finalZOffset = flangeOffset;
    const term1 = Math.pow(finalZOffset, 2);
    const term2 = Math.pow(hubFlangeDiameter / 2, 2);
    const term3 = Math.pow(finalErd / 2, 2);
    const term4 = 2 * (hubFlangeDiameter / 2) * (finalErd / 2) * Math.cos(angle);
    const geometricLength = Math.sqrt(term1 + term2 + term3 - term4);

    let finalLength;
    if (hubType === 'Classic Flange') {
        finalLength = geometricLength - (hubSpokeHoleDiameter / 2);
    } else if (hubType === 'Straight Pull') {
        finalLength = geometricLength + spOffset;
    } else {
        finalLength = geometricLength;
    }
    return finalLength;
}

export function isLacingPossible(spokeCount, crossPattern) {
    if (crossPattern === 0) return true;
    const angleBetweenHoles = 360 / (spokeCount / 2);
    const lacingAngle = crossPattern * angleBetweenHoles;
    return lacingAngle < 90;
}
