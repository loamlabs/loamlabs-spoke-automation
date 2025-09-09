// File: /_lib/calculator.js

// --- Berd-specific functions (placeholders if not available, update if you have the real logic) ---
export function calculateBerdFinalLength(metalLength, hubType, isLeft, context) {
    // This is a placeholder. If the real Berd logic exists, it should be placed here.
    // For now, we'll assume the metal length is the value to be rounded for testing.
    console.warn("Using placeholder Berd calculation logic.");
    return metalLength;
}

// --- Core Calculation Functions ---
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

// NOTE: The main `runCalculationEngine` function depends on Shopify data structures
// (`buildRecipe`, `componentData`). We will create a simplified version for our test
// harness directly in the new API endpoint, as it's easier than mocking those complex objects.
