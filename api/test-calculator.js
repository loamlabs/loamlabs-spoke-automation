// File: /api/test-calculator.js

import {
    applyRounding,
    calculateElongation,
    calculateSpokeLength,
    isLacingPossible,
    calculateBerdFinalLength
} from '../_lib/calculator.js';

// This is the main handler for our new endpoint
export default async function handler(req, res) {
    // --- Security Check ---
    // We only allow POST requests with a valid secret key.
    const expectedSecret = process.env.INTERNAL_API_SECRET;
    const providedSecret = req.headers['x-internal-secret'];

    if (!expectedSecret || providedSecret !== expectedSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    
    try {
        const inputs = req.body;

        // --- Simplified Calculation Runner (adapts test harness inputs) ---
        // We assume a 'rear' wheel calculation context for asymmetry, as it's the most common.
        const effectiveFlangeL = inputs.flange_l - inputs.rimAsymmetry;
        const effectiveFlangeR = inputs.flange_r + inputs.rimAsymmetry;
        
        let finalErd, washerPolicy;

        if (inputs.spokeVendor === 'Berd') {
            finalErd = inputs.rimErd + (2 * inputs.washerThickness);
            washerPolicy = "Mandatory (Berd)";
        } else { // Steel
            washerPolicy = "Optional";
            finalErd = inputs.rimErd + (2 * inputs.washerThickness);
        }
        
        if (!isLacingPossible(inputs.spokeCount, inputs.crossL) || !isLacingPossible(inputs.spokeCount, inputs.crossR)) {
            return res.status(400).json({ 
                calculationSuccessful: false, 
                error: `Lacing pattern ${inputs.crossL}/${inputs.crossR} is not geometrically possible for ${inputs.spokeCount}h.` 
            });
        }
        
        const commonParams = { 
          hubType: inputs.hubType, 
          spokeCount: inputs.spokeCount, 
          finalErd, 
          hubSpokeHoleDiameter: inputs.shd 
        };

        const paramsLeft = { ...commonParams, isLeft: true, baseCrossPattern: inputs.crossL, hubFlangeDiameter: inputs.pcd_l, flangeOffset: effectiveFlangeL, spOffset: inputs.spo_l };
        const paramsRight = { ...commonParams, isLeft: false, baseCrossPattern: inputs.crossR, hubFlangeDiameter: inputs.pcd_r, flangeOffset: effectiveFlangeR, spOffset: inputs.spo_r };

        let result;
        if (inputs.spokeVendor === 'Berd') {
            const metalLengthL = calculateSpokeLength(paramsLeft);
            const metalLengthR = calculateSpokeLength(paramsRight);
            const berdContext = { flangeL: effectiveFlangeL, flangeR: effectiveFlangeR, metalLengthL, metalLengthR };
            const finalBerdLengthL = calculateBerdFinalLength(metalLengthL, inputs.hubType, true, berdContext);
            const finalBerdLengthR = calculateBerdFinalLength(metalLengthR, inputs.hubType, false, berdContext);

            result = {
                lengths: {
                    left: { geo: finalBerdLengthL.toFixed(4), rounded: applyRounding(finalBerdLengthL, 'Berd') },
                    right: { geo: finalBerdLengthR.toFixed(4), rounded: applyRounding(finalBerdLengthR, 'Berd') }
                }
            };
        } else { // Steel
            const lengthL = calculateSpokeLength(paramsLeft);
            const lengthR = calculateSpokeLength(paramsRight);
            
            result = {
                lengths: {
                    left: { geo: lengthL.toFixed(4), stretch: calculateElongation(lengthL, inputs.targetTension, inputs.crossSectionArea).toFixed(4), rounded: applyRounding(lengthL, 'Steel') },
                    right: { geo: lengthR.toFixed(4), stretch: calculateElongation(lengthR, inputs.targetTension, inputs.crossSectionArea).toFixed(4), rounded: applyRounding(lengthR, 'Steel') }
                }
            };
        }
        
        const finalReport = {
          calculationSuccessful: true,
          ...result,
          inputs: { ...inputs, effectiveFlangeL, effectiveFlangeR, finalErd, washerPolicy }
        };

        return res.status(200).json(finalReport);

    } catch (e) {
      console.error("Internal Calculator API Error:", e);
      return res.status(500).json({ calculationSuccessful: false, error: e.message });
    }
}
