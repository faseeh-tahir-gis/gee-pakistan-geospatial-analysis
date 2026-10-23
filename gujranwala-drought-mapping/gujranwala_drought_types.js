// ============================================================================
// DROUGHT TYPES MAPPING — GUJRANWALA DISTRICT, PUNJAB, PAKISTAN
// Google Earth Engine JavaScript
// ============================================================================
//
// DROUGHT TYPES COVERED
//
// 1. METEOROLOGICAL DROUGHT
//    Abnormally low rainfall compared with the historical rainfall baseline.
//    Indicator: CHIRPS seasonal rainfall standardized anomaly.
//
// 2. AGRICULTURAL DROUGHT
//    Insufficient soil moisture and vegetation water availability for crops.
//    Indicators: SMAP soil-moisture anomaly and MODIS VHI.
//    Output is restricted to cropland.
//
// 3. VEGETATION / ECOLOGICAL DROUGHT
//    Vegetation stress caused by reduced greenness and high surface temperature.
//    Indicators: MODIS VCI, TCI and VHI.
//
// 4. HYDROLOGICAL DROUGHT PROXY
//    Reduced runoff and surface-water availability.
//    Indicator: TerraClimate seasonal runoff standardized anomaly.
//    This is a runoff proxy, not observed river discharge or groundwater.

// ============================================================================
// 1. USER SETTINGS
// ============================================================================

var targetYear = 2024;

// Main agricultural growing-season analysis.
var startMonth = 1;    // January
var endMonth = 12;     // December

// MODIS and CHIRPS baseline.
var baselineStartYear = 2001;
var baselineEndYear = 2020;

// SMAP starts in 2015.
var smapBaselineStartYear = 2015;
var smapBaselineEndYear = 2023;


// ============================================================================
// 2. DISTRICT BOUNDARY — Gujranwala (uploaded asset)
// ============================================================================

var aoi = ee.FeatureCollection(
  'projects/internship-503314/assets/Gujranwala_D'
);

Map.centerObject(aoi, 9);
Map.setOptions('HYBRID'); // satellite + labels, reads better behind translucent layers

Map.addLayer(
  aoi.style({
    color: 'FF0000',
    fillColor: '00000000',
    width: 2
  }),
  {},
  'Gujranwala boundary'
);


// ============================================================================
// 3. INFORMATION PANEL
// ============================================================================

var informationPanel = ui.Panel({
  style: {
    position: 'top-left',
    width: '370px',
    padding: '10px',
    backgroundColor: 'white'
  }
});

informationPanel.add(
  ui.Label({
    value: 'Drought Types — Gujranwala',
    style: {
      fontWeight: 'bold',
      fontSize: '18px',
      margin: '0 0 8px 0'
    }
  })
);

informationPanel.add(ui.Label('1. Meteorological: rainfall deficit'));
informationPanel.add(ui.Label('2. Agricultural: soil-moisture and crop stress'));
informationPanel.add(ui.Label('3. Vegetation: VCI, TCI and VHI stress'));
informationPanel.add(ui.Label('4. Hydrological proxy: runoff deficit'));

informationPanel.add(
  ui.Label({
    value: 'Study period: Jan–Dec ' + targetYear,
    style: {
      margin: '8px 0 4px 0',
      fontWeight: 'bold'
    }
  })
);

informationPanel.add(
  ui.Label({
    value: 'Note: MODIS Terra+Aqua fusion and AOI-mean gap-filling are ' +
      'applied so cloud/quality-masked pixels (e.g. over urban areas) do ' +
      'not appear as blank gaps in the drought layers.',
    style: {
      margin: '0',
      fontSize: '11px',
      color: '#555555'
    }
  })
);

Map.add(informationPanel);


// ============================================================================
// 4. DATE FUNCTIONS
// ============================================================================

function startDateForYear(year) {
  return ee.Date.fromYMD(ee.Number(year), startMonth, 1);
}

function endDateForYear(year) {
  return ee.Date.fromYMD(ee.Number(year), endMonth, 1)
    .advance(1, 'month');
}


// ============================================================================
// 5. GENERAL CLASSIFICATION FUNCTION
// ============================================================================
//
// Severity classes:
// 0 = No drought
// 1 = Mild drought
// 2 = Moderate drought
// 3 = Severe drought
// 4 = Extreme drought
//

function classifySeverity(severityImage, outputName) {
  return ee.Image(0)
    .where(severityImage.gte(20), 1)
    .where(severityImage.gte(40), 2)
    .where(severityImage.gte(60), 3)
    .where(severityImage.gte(80), 4)
    .rename(outputName);
}

// --- Helper: fill any remaining masked pixels with the AOI-wide mean ---
// Used as a final safety net after the Terra+Aqua fusion, so downstream
// band math (subtraction, division, weighted sums) never silently produces
// "no data" holes inside the district boundary.
function fillWithAoiMean(image, bandName, fillScale) {
  var meanValue = image.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: aoi,
    scale: fillScale,
    bestEffort: true,
    maxPixels: 1e10,
    tileScale: 8
  }).get(bandName);

  return image.unmask(ee.Image.constant(ee.Number(meanValue)));
}


// ============================================================================
// 6. MODIS NDVI (Terra + Aqua fusion)
// ============================================================================

function maskNdvi(image) {
  var summaryQa = image.select('SummaryQA');
  var goodQuality = summaryQa.eq(0); // 0 = good-quality vegetation-index data.

  return image.select('NDVI')
    .multiply(0.0001)
    .updateMask(goodQuality)
    .rename('NDVI')
    .copyProperties(image, ['system:time_start']);
}

var ndviTerra = ee.ImageCollection('MODIS/061/MOD13Q1')
  .filterBounds(aoi)
  .map(maskNdvi);

var ndviAqua = ee.ImageCollection('MODIS/061/MYD13Q1')
  .filterBounds(aoi)
  .map(maskNdvi);

// Merging Terra and Aqua lets a good-quality Aqua pixel fill a gap left by
// a cloud/QA-masked Terra pixel in the same period, and vice versa.
var ndviCollection = ndviTerra.merge(ndviAqua);

function seasonalNdvi(year) {
  year = ee.Number(year);
  return ndviCollection
    .filterDate(startDateForYear(year), endDateForYear(year))
    .median()
    .rename('NDVI')
    .set('year', year);
}


// ============================================================================
// 7. MODIS LAND-SURFACE TEMPERATURE (Terra + Aqua fusion)
// ============================================================================

function maskLst(image) {
  var qualityControl = image.select('QC_Day');
  var mandatoryQa = qualityControl.bitwiseAnd(3); // Bits 0-1 = mandatory QA.
  var goodQuality = mandatoryQa.eq(0);

  return image.select('LST_Day_1km')
    .multiply(0.02)
    .subtract(273.15)
    .updateMask(goodQuality)
    .rename('LST_C')
    .copyProperties(image, ['system:time_start']);
}

var lstTerra = ee.ImageCollection('MODIS/061/MOD11A2')
  .filterBounds(aoi)
  .map(maskLst);

var lstAqua = ee.ImageCollection('MODIS/061/MYD11A2')
  .filterBounds(aoi)
  .map(maskLst);

var lstCollection = lstTerra.merge(lstAqua);

function seasonalLst(year) {
  year = ee.Number(year);
  return lstCollection
    .filterDate(startDateForYear(year), endDateForYear(year))
    .median()
    .rename('LST_C')
    .set('year', year);
}


// ============================================================================
// 8. NDVI AND LST BASELINE
// ============================================================================

var baselineYears = ee.List.sequence(baselineStartYear, baselineEndYear);

var ndviBaseline = ee.ImageCollection.fromImages(
  baselineYears.map(function(year) {
    return seasonalNdvi(year);
  })
);

var lstBaseline = ee.ImageCollection.fromImages(
  baselineYears.map(function(year) {
    return seasonalLst(year);
  })
);

var targetNdvi = seasonalNdvi(targetYear);
var targetLst = seasonalLst(targetYear);

var ndviMinimum = ndviBaseline.min();
var ndviMaximum = ndviBaseline.max();

var lstMinimum = lstBaseline.min();
var lstMaximum = lstBaseline.max();


// ============================================================================
// 9. VEGETATION CONDITION INDEX
// ============================================================================
// VCI = 100 x (NDVIcurrent - NDVIminimum) / (NDVImaximum - NDVIminimum)

var vci = targetNdvi
  .subtract(ndviMinimum)
  .divide(ndviMaximum.subtract(ndviMinimum).max(0.001))
  .multiply(100)
  .clamp(0, 100)
  .rename('VCI');


// ============================================================================
// 10. TEMPERATURE CONDITION INDEX
// ============================================================================
// TCI = 100 x (LSTmaximum - LSTcurrent) / (LSTmaximum - LSTminimum)

var tci = lstMaximum
  .subtract(targetLst)
  .divide(lstMaximum.subtract(lstMinimum).max(0.1))
  .multiply(100)
  .clamp(0, 100)
  .rename('TCI');


// ============================================================================
// 11. VEGETATION HEALTH INDEX
// ============================================================================
// VHI = 0.5 x VCI + 0.5 x TCI

var vhiRaw = vci.multiply(0.5)
  .add(tci.multiply(0.5))
  .rename('VHI');

var vhi = fillWithAoiMean(vhiRaw, 'VHI', 250);

// ============================================================================
// 12. VEGETATION / ECOLOGICAL DROUGHT
// ============================================================================
// High VHI = healthy vegetation. Low VHI = stronger vegetation drought.

var vegetationDroughtSeverity = ee.Image(100)
  .subtract(vhi)
  .rename('vegetation_drought_severity');

var vegetationDroughtClass = ee.Image(0)
  .where(vhi.lt(40), 1)
  .where(vhi.lt(30), 2)
  .where(vhi.lt(20), 3)
  .where(vhi.lt(10), 4)
  .rename('vegetation_drought_class');


// ============================================================================
// 13. CHIRPS RAINFALL
// ============================================================================

var chirps = ee.ImageCollection('UCSB-CHC/CHIRPS/V3/DAILY_RNL')
  .filterBounds(aoi)
  .select('precipitation');

function seasonalRainfall(year) {
  year = ee.Number(year);
  return chirps
    .filterDate(startDateForYear(year), endDateForYear(year))
    .sum()
    .rename('rainfall_mm')
    .set('year', year);
}

var rainfallBaseline = ee.ImageCollection.fromImages(
  baselineYears.map(function(year) {
    return seasonalRainfall(year);
  })
);

var targetRainfall = seasonalRainfall(targetYear);

var rainfallMean = rainfallBaseline.mean();

var rainfallStandardDeviation = rainfallBaseline
  .reduce(ee.Reducer.stdDev())
  .rename('rainfall_mm')
  .max(0.1);

var rainfallZRaw = targetRainfall
  .subtract(rainfallMean)
  .divide(rainfallStandardDeviation)
  .rename('rainfall_z');

var rainfallZ = fillWithAoiMean(rainfallZRaw, 'rainfall_z', 5000);


// ============================================================================
// 14. METEOROLOGICAL DROUGHT
// ============================================================================
//
// Negative rainfall z-score = below-normal rainfall.
//
// Approximate classes:
// z > -0.5   = no drought
// z <= -0.5  = mild
// z <= -1.0  = moderate
// z <= -1.5  = severe
// z <= -2.0  = extreme
//

var meteorologicalDroughtSeverity = rainfallZ
  .multiply(-50)
  .clamp(0, 100)
  .rename('meteorological_drought_severity');

var meteorologicalDroughtClass = ee.Image(0)
  .where(rainfallZ.lte(-0.5), 1)
  .where(rainfallZ.lte(-1.0), 2)
  .where(rainfallZ.lte(-1.5), 3)
  .where(rainfallZ.lte(-2.0), 4)
  .rename('meteorological_drought_class');


// ============================================================================
// 15. SMAP SOIL MOISTURE
// ============================================================================

function maskSmap(image) {
  var qualityFlag = image.select('retrieval_qual_flag_am');
  var goodQuality = qualityFlag.eq(0);

  return image.select('soil_moisture_am')
    .updateMask(goodQuality)
    .rename('soil_moisture')
    .copyProperties(image, ['system:time_start']);
}

// Version 005 covers the older period.
var smapVersion005 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005')
  .filterBounds(aoi)
  .filterDate('2015-04-01', '2023-12-04')
  .map(maskSmap);

// Version 006 covers 4 December 2023 onward.
var smapVersion006 = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/006')
  .filterBounds(aoi)
  .filterDate('2023-12-04', '2026-12-31')
  .map(maskSmap);

var smapCollection = smapVersion005.merge(smapVersion006);

function seasonalSoilMoisture(year) {
  year = ee.Number(year);
  return smapCollection
    .filterDate(startDateForYear(year), endDateForYear(year))
    .mean()
    .rename('soil_moisture')
    .set('year', year);
}

var smapBaselineYears = ee.List.sequence(
  smapBaselineStartYear,
  smapBaselineEndYear
);

var smapBaseline = ee.ImageCollection.fromImages(
  smapBaselineYears.map(function(year) {
    return seasonalSoilMoisture(year);
  })
);

var targetSoilMoisture = seasonalSoilMoisture(targetYear);

var soilMoistureMean = smapBaseline.mean();

var soilMoistureStandardDeviation = smapBaseline
  .reduce(ee.Reducer.stdDev())
  .rename('soil_moisture')
  .max(0.001);

var soilMoistureZRaw = targetSoilMoisture
  .subtract(soilMoistureMean)
  .divide(soilMoistureStandardDeviation)
  .rename('soil_moisture_z');

// SMAP is coarse resolution (~9-36 km), so use a larger fill scale.
var soilMoistureZ = fillWithAoiMean(soilMoistureZRaw, 'soil_moisture_z', 9000);

var soilMoistureDeficit = soilMoistureZ
  .multiply(-50)
  .clamp(0, 100)
  .rename('soil_moisture_deficit');


// ============================================================================
// 16. CROPLAND MASK
// ============================================================================

var worldCover = ee.ImageCollection('ESA/WorldCover/v200')
  .first()
  .select('Map')
  .clip(aoi);

// ESA WorldCover class 40 = cropland.
var croplandMask = worldCover.eq(40);


// ============================================================================
// 17. AGRICULTURAL DROUGHT
// ============================================================================

var agriculturalDroughtSeverity = soilMoistureDeficit
  .multiply(0.60)
  .add(vegetationDroughtSeverity.multiply(0.40))
  .clamp(0, 100)
  .updateMask(croplandMask)
  .rename('agricultural_drought_severity');

var agriculturalDroughtClass = classifySeverity(
  agriculturalDroughtSeverity,
  'agricultural_drought_class'
).updateMask(croplandMask);


// ============================================================================
// 18. TERRACLIMATE RUNOFF
// ============================================================================

var terraClimate = ee.ImageCollection('IDAHO_EPSCOR/TERRACLIMATE')
  .filterBounds(aoi)
  .select('ro');

function seasonalRunoff(year) {
  year = ee.Number(year);
  return terraClimate
    .filterDate(startDateForYear(year), endDateForYear(year))
    .sum()
    .rename('runoff_mm')
    .set('year', year);
}

var runoffBaseline = ee.ImageCollection.fromImages(
  baselineYears.map(function(year) {
    return seasonalRunoff(year);
  })
);

var targetRunoff = seasonalRunoff(targetYear);

var runoffMean = runoffBaseline.mean();

var runoffStandardDeviation = runoffBaseline
  .reduce(ee.Reducer.stdDev())
  .rename('runoff_mm')
  .max(0.1);

var runoffZRaw = targetRunoff
  .subtract(runoffMean)
  .divide(runoffStandardDeviation)
  .rename('runoff_z');

var runoffZ = fillWithAoiMean(runoffZRaw, 'runoff_z', 4000);


// ============================================================================
// 19. HYDROLOGICAL DROUGHT PROXY
// ============================================================================

var hydrologicalDroughtSeverity = runoffZ
  .multiply(-50)
  .clamp(0, 100)
  .rename('hydrological_drought_severity');

var hydrologicalDroughtClass = ee.Image(0)
  .where(runoffZ.lte(-0.5), 1)
  .where(runoffZ.lte(-1.0), 2)
  .where(runoffZ.lte(-1.5), 3)
  .where(runoffZ.lte(-2.0), 4)
  .rename('hydrological_drought_class');


// ============================================================================
// 20. COMBINED DROUGHT SEVERITY
// ============================================================================
//
// Combined index:
// 35% meteorological drought
// 30% agricultural drought
// 20% vegetation drought
// 15% hydrological drought proxy

var agriculturalForCombined = agriculturalDroughtSeverity.unmask(0);

var combinedDroughtSeverity = meteorologicalDroughtSeverity.multiply(0.35)
  .add(agriculturalForCombined.multiply(0.30))
  .add(vegetationDroughtSeverity.multiply(0.20))
  .add(hydrologicalDroughtSeverity.multiply(0.15))
  .clamp(0, 100)
  .rename('combined_drought_severity');

var combinedDroughtClass = classifySeverity(
  combinedDroughtSeverity,
  'combined_drought_class'
);


// ============================================================================
// 21. VISUALISATION SETTINGS
// ============================================================================

var conditionPalette = ['8b0000', 'ff8c00', 'ffff00', '90ee90', '006400'];

var anomalyPalette = [
  '8b0000', 'f46d43', 'fdae61', 'ffffff', '74add1', '313695'
];

// Single shared palette for BOTH the discrete class legend and the continuous severity color bar, so the two legends read consistently

var droughtSeverityPalette = ['2ca25f', 'ffffb2', 'fecc5c', 'fd8d3c', 'bd0026'];
var droughtClassPalette = droughtSeverityPalette;


// ============================================================================
// 22. MAP LAYERS
// ============================================================================

// Vegetation indicators
Map.addLayer(vci.clip(aoi), {min: 0, max: 100, palette: conditionPalette}, 'VCI', false);
Map.addLayer(tci.clip(aoi), {min: 0, max: 100, palette: conditionPalette}, 'TCI', false);
Map.addLayer(vhi.clip(aoi), {min: 0, max: 100, palette: conditionPalette}, 'VHI', false);

// Meteorological drought
Map.addLayer(
  rainfallZ.clip(aoi),
  {min: -2.5, max: 2.5, palette: anomalyPalette},
  'Rainfall standardized anomaly',
  false
);

Map.addLayer(
  meteorologicalDroughtClass.clip(aoi),
  {min: 0, max: 4, palette: droughtClassPalette},
  '1. Meteorological drought'
);

// Agricultural drought
Map.addLayer(
  soilMoistureZ.clip(aoi),
  {min: -2.5, max: 2.5, palette: anomalyPalette},
  'SMAP soil-moisture anomaly',
  false
);

Map.addLayer(
  agriculturalDroughtClass.clip(aoi),
  {min: 0, max: 4, palette: droughtClassPalette},
  '2. Agricultural drought',
  false
);

// Vegetation drought
Map.addLayer(
  vegetationDroughtClass.clip(aoi),
  {min: 0, max: 4, palette: droughtClassPalette},
  '3. Vegetation drought',
  false
);

// Hydrological drought proxy
Map.addLayer(
  runoffZ.clip(aoi),
  {min: -2.5, max: 2.5, palette: anomalyPalette},
  'Runoff standardized anomaly',
  false
);

Map.addLayer(
  hydrologicalDroughtClass.clip(aoi),
  {min: 0, max: 4, palette: droughtClassPalette},
  '4. Hydrological drought proxy',
  false
);

// Combined drought
Map.addLayer(
  combinedDroughtSeverity.clip(aoi),
  {min: 0, max: 100, palette: droughtSeverityPalette},
  'Combined drought severity'
);

Map.addLayer(
  combinedDroughtClass.clip(aoi),
  {min: 0, max: 4, palette: droughtClassPalette},
  'Combined drought classes',
  false
);


// ============================================================================
// 22B. LEGENDS (bottom-right)
// ============================================================================
function makeLegendRow(color, label) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: color,
      padding: '8px',
      margin: '0 6px 4px 0',
      border: '1px solid #666'
    }
  });

  var description = ui.Label({
    value: label,
    style: {
      margin: '0 0 4px 0',
      fontSize: '12px'
    }
  });

  return ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
}

// --- Discrete drought-class legend (0-4) ---
var classLegendPanel = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 10px',
    margin: '0 0 8px 0',
    backgroundColor: 'white'
  }
});

classLegendPanel.add(
  ui.Label({
    value: 'Drought Severity Class',
    style: {
      fontWeight: 'bold',
      fontSize: '13px',
      margin: '0 0 6px 0'
    }
  })
);

var droughtClassLabels = [
  'No drought',
  'Mild drought',
  'Moderate drought',
  'Severe drought',
  'Extreme drought'
];

for (var i = 0; i < droughtClassPalette.length; i++) {
  classLegendPanel.add(
    makeLegendRow(droughtClassPalette[i], droughtClassLabels[i])
  );
}

Map.add(classLegendPanel);

// --- Continuous severity color bar (0-100) ---
var severityLegendPanel = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 10px',
    backgroundColor: 'white'
  }
});

severityLegendPanel.add(
  ui.Label({
    value: 'Combined Drought Severity',
    style: {
      fontWeight: 'bold',
      fontSize: '13px',
      margin: '0 0 6px 0'
    }
  })
);

function buildColorBarThumbnail(palette) {
  return ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: {
      bbox: [0, 0, 1, 0.1],
      dimensions: '200x12',
      format: 'png',
      min: 0,
      max: 1,
      palette: palette
    },
    style: {
      stretch: 'horizontal',
      margin: '0 0 4px 0',
      maxHeight: '14px'
    }
  });
}

severityLegendPanel.add(buildColorBarThumbnail(droughtSeverityPalette));

var severityScaleRow = ui.Panel({
  widgets: [
    ui.Label('0 (low)', {margin: '0 4px 0 0', fontSize: '11px'}),
    ui.Label({
      value: '',
      style: {stretch: 'horizontal'}
    }),
    ui.Label('100 (high)', {margin: '0 0 0 4px', fontSize: '11px'})
  ],
  layout: ui.Panel.Layout.Flow('horizontal')
});

severityLegendPanel.add(severityScaleRow);

Map.add(severityLegendPanel);


// ============================================================================
// 23. SUMMARY STATISTICS
// ============================================================================

var areaByClassImage = ee.Image.pixelArea()
  .divide(1e6)
  .rename('area_km2')
  .addBands(combinedDroughtClass);

var areaByClass = areaByClassImage.reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: 'class'
  }),
  geometry: aoi,
  scale: 5000,
  bestEffort: true,
  maxPixels: 1e13,
  tileScale: 16
});

print('Combined drought — area by class (km²)', areaByClass);
print('Class key: 0=none, 1=mild, 2=moderate, 3=severe, 4=extreme');

// ----------------------------------------------------------------------
// OPTIONAL: export the same table to Drive as a batch task instead of
// printing it interactively. Uncomment to use. Run from the Tasks tab.
// ----------------------------------------------------------------------
// Export.table.toDrive({
//   collection: ee.FeatureCollection([ee.Feature(null, areaByClass)]),
//   description: 'Gujranwala_combined_drought_area_by_class_' + targetYear,
//   fileFormat: 'CSV'
// });


// ============================================================================
// RESEARCH BASIS
// ============================================================================
//
// Kogan, F.N. (1995)
// Vegetation Condition Index, Temperature Condition Index and drought.
//
// McKee, T.B., Doesken, N.J. and Kleist, J. (1993)
// Standardized Precipitation Index framework.
//
// Chan et al. (2016)
// SMAP soil-moisture product assessment.
//
// Abatzoglou et al. (2018)
// TerraClimate global monthly climate and water-balance dataset.
//
// IMPORTANT LIMITATIONS
//
// 1. rainfallZ is a standardized rainfall anomaly, not formal SPI.
// 2. SMAP measures near-surface soil moisture, not full root-zone moisture.
// 3. TerraClimate runoff is modelled rather than measured river discharge.
// 4. AOI-mean gap-filling replaces isolated masked pixels with the district-
//    wide average of that variable; it does not invent new spatial detail,
//    so large persistently-masked regions should still be treated with
//    caution and validated against ground observations.
// 5. Validate outputs using PMD rainfall stations, irrigation records,
//    stream gauges, crop reports and field observations.
// 6. The combined drought weights are provisional.
// 7. Hydrological drought should ideally use river-flow, groundwater,
//    reservoir-storage and canal-supply observations.
// ============================================================================
