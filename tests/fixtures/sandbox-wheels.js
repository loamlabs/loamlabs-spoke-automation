// I9-SYSTEM: the Studio sandbox wheels (same numbers as the theme's tests/spoke-studio-geometry.test.js and i9-system.js CFG.sample).
// Used by the drift test and by scripts/update-geometry-fixture.mjs.
export const SANDBOX_WHEELS = {
  solixRear24: { wheels: { rear: { erd: 568, rimHoles: 24, drive: { n: 16, pcd: 52, cross: 3.5 }, rotor: { n: 8, pcd: 40, cross: 1.4 } } } },
  solixFront24: { wheels: { front: { erd: 568, rimHoles: 24, drive: { n: 8, pcd: 40, cross: 1.4 }, rotor: { n: 16, pcd: 43, cross: 3.5 } } } },
  hydra2Front28: { wheels: { front: { erd: 590, rimHoles: 28, drive: { n: 14, pcd: 46, cross: 2 }, rotor: { n: 14, pcd: 46, cross: 2 } } } },
  hydra2Front32: { wheels: { front: { erd: 590, rimHoles: 32, drive: { n: 16, pcd: 46, cross: 2 }, rotor: { n: 16, pcd: 46, cross: 2 } } } },
  hydra2Front32x3: { wheels: { front: { erd: 590, rimHoles: 32, drive: { n: 16, pcd: 46, cross: 3 }, rotor: { n: 16, pcd: 46, cross: 3 } } } }, // the theme test's own variant
  hydra2Rear28: { wheels: { rear: { erd: 590, rimHoles: 28, drive: { n: 14, pcd: 54, cross: 3 }, rotor: { n: 14, pcd: 54, cross: 3 } } } }, // 'rear:28' lacing phase; not sold, geometry check only (no sample order)
  hydra2Rear32: { wheels: { rear: { erd: 590, rimHoles: 32, drive: { n: 16, pcd: 54, cross: 3 }, rotor: { n: 16, pcd: 54, cross: 3 } } } },
  // both wheels in one config, as the real Studio gets them
  solixSet: { wheels: {
    front: { erd: 568, rimHoles: 24, drive: { n: 8, pcd: 40, cross: 1.4 }, rotor: { n: 16, pcd: 43, cross: 3.5 } },
    rear: { erd: 568, rimHoles: 24, drive: { n: 16, pcd: 52, cross: 3.5 }, rotor: { n: 8, pcd: 40, cross: 1.4 } }
  } },
  hydra2Set32: { wheels: {
    front: { erd: 590, rimHoles: 32, drive: { n: 16, pcd: 46, cross: 2 }, rotor: { n: 16, pcd: 46, cross: 2 } },
    rear: { erd: 590, rimHoles: 32, drive: { n: 16, pcd: 54, cross: 3 }, rotor: { n: 16, pcd: 54, cross: 3 } }
  } }
};

// The wheels of the theme's golden file (theme-dev/tests/fixtures/spoke-studio-geometry-non-24h-2to1.json): every wheel EXCEPT the Solix 24h 2:1 pair,
// whose geometry must be exactly what it was before the explicit Solix 24h table. Same names and numbers as the theme's own test.
export const GOLDEN_WHEELS = {
  hydraFront: { wheels: { front: { erd: 590, rimHoles: 28, drive: { n: 14, pcd: 46, cross: 2 }, rotor: { n: 14, pcd: 46, cross: 2 } } } },
  hydraRear: { wheels: { rear: { erd: 590, rimHoles: 32, drive: { n: 16, pcd: 54, cross: 3 }, rotor: { n: 16, pcd: 54, cross: 3 } } } },
  hydraRear28: { wheels: { rear: { erd: 590, rimHoles: 28, drive: { n: 14, pcd: 54, cross: 2 }, rotor: { n: 14, pcd: 54, cross: 2 } } } },
  hydraFront32: { wheels: { front: { erd: 590, rimHoles: 32, drive: { n: 16, pcd: 46, cross: 3 }, rotor: { n: 16, pcd: 46, cross: 3 } } } },
  hydra20: { wheels: { front: { erd: 590, rimHoles: 20, drive: { n: 10, pcd: 44, cross: 2 }, rotor: { n: 10, pcd: 44, cross: 2 } } } },
  hydra36: { wheels: { rear: { erd: 590, rimHoles: 36, drive: { n: 18, pcd: 56, cross: 3 }, rotor: { n: 18, pcd: 56, cross: 3 } } } },
  solix30: { wheels: { rear: { erd: 570, rimHoles: 30, drive: { n: 20, pcd: 52, cross: 3.5 }, rotor: { n: 10, pcd: 40, cross: 1.4 } } } },
  solix36: { wheels: { rear: { erd: 580, rimHoles: 36, drive: { n: 24, pcd: 54, cross: 3.5 }, rotor: { n: 12, pcd: 42, cross: 1.4 } } } }
};
