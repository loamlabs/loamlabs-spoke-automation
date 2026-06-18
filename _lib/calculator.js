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
export function applyRounding(length, vendor, isPolylightX = false) {
    if (vendor === 'Berd') {
        if (isPolylightX) {
            // Berd recommends +1mm for PolylightX, even with a puller
            return Math.round(length) + 1;
        }
        // Standard Polylight with your spoke puller tool (-2mm deduction)
        return Math.round(length) - 2;
    }
    // Standard Steel rounding (Round up to nearest even number)
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
    const { 
        hubType, 
        baseCrossPattern, 
        spokeCount, 
        finalErd, 
        hubFlangeDiameter, 
        flangeOffset, 
        spOffset = 0, 
        hubSpokeHoleDiameter = 2.6 
    } = params;

    if (hubType === 'Straight Pull') {
        // --- TANGENTIAL MATH (Physics-based) ---
        const R = finalErd / 2;
        const r = hubFlangeDiameter / 2;
        const d = spOffset;
        const f = flangeOffset;

        const radialComponent = Math.sqrt(R * R - d * d) - Math.sqrt(r * r - d * d);
        return Math.sqrt(Math.pow(radialComponent, 2) + Math.pow(f, 2));

    } else {
        // --- LAW OF COSINES (Angle-based for J-Bend & Hook Flange) ---
        const angle = (2 * Math.PI * baseCrossPattern) / (spokeCount / 2);
        
        const term1 = Math.pow(flangeOffset, 2);
        const term2 = Math.pow(hubFlangeDiameter / 2, 2);
        const term3 = Math.pow(finalErd / 2, 2);
        const term4 = 2 * (hubFlangeDiameter / 2) * (finalErd / 2) * Math.cos(angle);
        
        const geometricLength = Math.sqrt(term1 + term2 + term3 - term4);

        if (hubType === 'Classic Flange') {
            // Subtract half the hole diameter for the elbow seat
            return geometricLength - (hubSpokeHoleDiameter / 2);
        }
        
        // For Hook Flange, we return the full length (no elbow deduction)
        return geometricLength;
    }
}

export function isLacingPossible(spokeCount, crossPattern) {
    if (crossPattern === 0) return true;
    const angleBetweenHoles = 360 / (spokeCount / 2);
    const lacingAngle = crossPattern * angleBetweenHoles;
    return lacingAngle < 90;
}
