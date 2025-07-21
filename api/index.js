import { createHmac } from 'crypto';

// --- Vercel Config ---
export const config = { api: { bodyParser: false } };

// --- Helper Functions (Defined Once) ---
async function getRawBody(req) { /* ... */ }
async function shopifyAdminApiQuery(query, variables) { /* ... */ }
async function fetchComponentData(buildRecipe) { /* ... */ }
function calculateElongation(spokeLength, tensionKgf, crossSectionalArea) { /* ... */ }
function calculateSpokeLength(params) { /* ... */ }

// --- *** FINAL: "SPEC-COMPLIANT" CALCULATION ENGINE *** ---
function runCalculationEngine(buildRecipe, componentData) {
    const results = { front: null, rear: null, errors: [] };
    const getMeta = (variantId, productId, key, isNumber = false, defaultValue = 0) => {
        const variantMeta = componentData.get(variantId) || {};
        const productMeta = componentData.get(productId) || {};
        const value = variantMeta[key] ?? productMeta[key];
        if (value === undefined || value === null || value === '') { return isNumber ? defaultValue : null; }
        return isNumber ? parseFloat(value) : value;
    };

    const calculateForPosition = (position) => {
        const rim = buildRecipe.components[`${position}Rim`];
        const hub = buildRecipe.components[`${position}Hub`];
        const spokes = buildRecipe.components[`${position}Spokes`];
        const spokeCount = parseInt(buildRecipe.specs[`${position}SpokeCount`]?.replace('h', ''), 10);
        if (!rim || !hub || !spokes || !spokeCount) { return { calculationSuccessful: false, error: `Skipping ${position} wheel: Missing component.` }; }

        const hubType = getMeta(hub.variantId, hub.productId, 'hub_type');
        if (hubType === 'Hook Flange' || getMeta(spokes.variantId, spokes.productId, 'spoke_type') === 'BERD') {
            return { calculationSuccessful: false, error: `Unsupported type (${hubType || 'BERD'}).` };
        }

        let finalErd = getMeta(rim.variantId, rim.productId, 'rim_erd', true);
        if (getMeta(rim.variantId, rim.productId, 'rim_washer_policy') !== 'Not Compatible') {
            finalErd += (2 * getMeta(rim.variantId, rim.productId, 'rim_nipple_washer_thickness_mm', true));
        }
        
        const tensionKgf = getMeta(rim.variantId, rim.productId, 'rim_target_tension_kgf', true, 120);

        const runCalcForCross = (crossPattern) => {
            const commonParams = { /* ... */ }; // This logic is unchanged
            const paramsLeft = { /* ... */ };
            const paramsRight = { /* ... */ };
            // Populate full params objects...
            Object.assign(commonParams, { hubType, baseCrossPattern: crossPattern, spokeCount, finalErd, rimSpokeHoleOffset: getMeta(rim.variantId, rim.productId, 'rim_spoke_hole_offset', true), hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true) });
            Object.assign(paramsLeft, { ...commonParams, isLeft: true, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_left', true), flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_left', true), spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_left', true) });
            Object.assign(paramsRight, { ...commonParams, isLeft: false, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_right', true), flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_right', true), spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_right', true) });

            const lengthL = calculateSpokeLength(paramsLeft);
            const lengthR = calculateSpokeLength(paramsRight);
            const crossArea = getMeta(spokes.variantId, spokes.productId, 'spoke_cross_sectional_area_mm2', true) || getMeta(spokes.variantId, spokes.productId, 'spoke_cross_section_area_mm2', true);
            
            return {
                left: { geo: lengthL.toFixed(2), stretch: calculateElongation(lengthL, tensionKgf, crossArea).toFixed(2) },
                right: { geo: lengthR.toFixed(2), stretch: calculateElongation(lengthR, tensionKgf, crossArea).toFixed(2) }
            };
        };
        
        const hubLacingPolicy = getMeta(hub.variantId, hub.productId, 'hub_lacing_policy');
        const hubManualCrossValue = getMeta(hub.variantId, hub.productId, 'hub_manual_cross_value', true);
        
        let crossPatternsToRun = [];
        if (hubLacingPolicy === 'Use Manual Override Field' && hubManualCrossValue > 0) {
            crossPatternsToRun.push(hubManualCrossValue);
        } else if (spokeCount === 28) {
            crossPatternsToRun = [2, 3];
        } else {
            crossPatternsToRun.push((spokeCount >= 32) ? 3 : 2);
        }

        return {
            calculationSuccessful: true,
            results: crossPatternsToRun.map(cross => ({ crossPattern: cross, lengths: runCalcForCross(cross) })),
            inputs: {
                rim: rim.title,
                hub: hub.title,
                spokes: spokes.title, // ADDED
                targetTension: tensionKgf, // ADDED
                finalErd: finalErd.toFixed(2)
            }
        };
    };
    
    try {
        results.front = calculateForPosition('front');
        if (buildRecipe.buildType === 'Wheel Set') {
            results.rear = calculateForPosition('rear');
        }
    } catch (e) { results.errors.push(e.message); }
    return results;
}

// --- *** FINAL: "SPEC-COMPLIANT" Note Formatter *** ---
function formatNote(report) {
    let note = "AUTOMATED SPOKE CALCULATION COMPLETE\n---------------------------------------\n";
    const formatSide = (wheel, position) => {
        if (!wheel) return ``;
        if (!wheel.calculationSuccessful) return `\n${position.toUpperCase()} WHEEL: CALC FAILED - ${wheel.error}`;
        
        let wheelNote = `\n${position.toUpperCase()} WHEEL:\n` +
                        `  Rim: ${wheel.inputs.rim}\n` +
                        `  Hub: ${wheel.inputs.hub}\n` +
                        `  Spokes: ${wheel.inputs.spokes}\n` +
                        `  Target Tension: ${wheel.inputs.targetTension} kgf`;

        wheel.results.forEach(res => {
            wheelNote += `\n  [${res.crossPattern}-Cross]` +
                         `\n    Left (Geo):  ${res.lengths.left.geo} mm (Stretch: ${res.lengths.left.stretch} mm)` +
                         `\n    Right (Geo): ${res.lengths.right.geo} mm (Stretch: ${res.lengths.right.stretch} mm)`;
        });
        return wheelNote;
    };
    note += formatSide(report.front, 'Front');
    note += formatSide(report.rear, 'Rear');
    if (report.errors && report.errors.length > 0) { note += `\n\nWARNINGS:\n- ${report.errors.join('\n- ')}`; }
    return note;
}

async function addNoteToOrder(orderGid, note) { /* ... */ }

// --- MAIN HANDLER FUNCTION (Unchanged from previous final version) ---
export default async function handler(req, res) { /* ... */ }


// --- PASTE THE FULL, UNCHANGED DEFINITIONS OF THE REMAINING FUNCTIONS HERE ---
// (getRawBody, shopifyAdminApiQuery, fetchComponentData, calculateElongation, calculateSpokeLength, addNoteToOrder, and the full handler function)
