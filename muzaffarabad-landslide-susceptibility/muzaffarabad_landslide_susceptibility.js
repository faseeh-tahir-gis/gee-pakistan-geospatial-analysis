// ================================================================
// LANDSLIDE SUSCEPTIBILITY — WEIGHTED GIS OVERLAY
// Muzaffarabad Tehsil, Muzaffarabad District, Azad Jammu & Kashmir, PAKISTAN
// Google Earth Engine (JavaScript)
// ================================================================

// ---------------- USER SETTINGS ----------------
var rainfallStart = '2001-01-01';
var rainfallEnd = '2025-01-01';
var rainfallStartMonth = 6;
var rainfallEndMonth = 9;

var streamAreaThresholdKm2 = 100;
var maximumStreamDistanceM = 5000;

// Provisional weights — recalibrate against a landslide inventory.
var wSlope = 0.35;
var wRain = 0.25;
var wDrainage = 0.15;
var wLandCover = 0.15;
var wVegetation = 0.10;

// ---------------- AREA OF INTEREST ----------------
// Muzaffarabad Tehsil, Muzaffarabad District, Azad Jammu & Kashmir —
// loaded directly from a pre-uploaded Earth Engine asset.
var aoiAssetId = 'projects/internship-503314/assets/Muzaffarabad';
var aoiFeatures = ee.FeatureCollection(aoiAssetId);

var aoiFeatureCount = aoiFeatures.size();
print('Muzaffarabad asset feature count:', aoiFeatureCount);
print('Muzaffarabad asset property names (first feature):',
  ee.Feature(aoiFeatures.first()).propertyNames());

// Fail loudly and early rather than letting an empty/missing asset

aoiFeatureCount.evaluate(function (n) {
  if (n === 0) {
    throw new Error(
      'Asset "' + aoiAssetId + '" loaded but contains zero features. ' +
      'Confirm the asset ID is correct and that it has been shared ' +
      '(Reader access) with anyone who needs to run this script.'
    );
  }
});

var aoi = aoiFeatures.geometry();

Map.centerObject(aoiFeatures, 11);
Map.addLayer(
  aoiFeatures.style({ color: '000000', fillColor: '00000000', width: 3 }),
  {},
  'Muzaffarabad Tehsil boundary'
);

// ---------------- TERRAIN ----------------
var dem = ee.Image('USGS/SRTMGL1_003').clip(aoi);
var slope = ee.Terrain.slope(dem).rename('slope_deg');
var slopePercent = slope.multiply(Math.PI / 180).tan().multiply(100).rename('slope_percent');

var slopeScore = slope.divide(45).clamp(0, 1).rename('slope_score');

// Elevation and slope summary statistics, computed once here and reused
// by the statistics panel below. SRTM native resolution is ~30 m; a
// matching reduceRegion scale is used so reported figures are not
// artificially smoothed or inflated by resampling.
var terrainStats = dem.rename('elevation_m').addBands(slope).addBands(slopePercent)
  .reduceRegion({
    reducer: ee.Reducer.min()
      .combine({ reducer2: ee.Reducer.mean(), sharedInputs: true })
      .combine({ reducer2: ee.Reducer.max(), sharedInputs: true }),
    geometry: aoi,
    scale: 30,
    maxPixels: 1e13,
    bestEffort: true,
    tileScale: 4
  });

// ---------------- EXTREME RAINFALL ----------------
// Long-term 95th percentile of daily monsoon-season rainfall.
// CHIRPS is ~5.6 km; resampling does not add finer detail.
var chirps = ee.ImageCollection('UCSB-CHC/CHIRPS/V3/DAILY_RNL')
  .filterDate(rainfallStart, rainfallEnd)
  .filter(ee.Filter.calendarRange(rainfallStartMonth, rainfallEndMonth, 'month'))
  .select('precipitation');

var rainP95 = chirps.reduce(ee.Reducer.percentile([95]))
  .rename('rain_p95_mm_day')
  .clip(aoi);

var rainStats = rainP95.reduceRegion({
  reducer: ee.Reducer.percentile([5, 95]),
  geometry: aoi,
  scale: 5566,
  bestEffort: true,
  maxPixels: 1e13,
  tileScale: 4
});

var rainP5Value = ee.Number(rainStats.get('rain_p95_mm_day_p5'));
var rainP95Value = ee.Number(rainStats.get('rain_p95_mm_day_p95'));

var rainScore = rainP95
  .unitScale(rainP5Value, rainP95Value)
  .clamp(0, 1)
  .rename('rain_score');

// Full min/mean/max (reusing the 5/95 percentile call above only gave
// the tails needed for normalization; this adds the mean for reporting).
var rainSummaryStats = rainP95.reduceRegion({
  reducer: ee.Reducer.min()
    .combine({ reducer2: ee.Reducer.mean(), sharedInputs: true })
    .combine({ reducer2: ee.Reducer.max(), sharedInputs: true }),
  geometry: aoi,
  scale: 5566,
  bestEffort: true,
  maxPixels: 1e13,
  tileScale: 4
});

// ---------------- DRAINAGE PROXIMITY ----------------
var merit = ee.Image('MERIT/Hydro/v1_0_1').clip(aoi);
var streams = merit.select('upa').gte(streamAreaThresholdKm2).selfMask();

var distanceToStream = streams.unmask(0)
  .distance(ee.Kernel.euclidean(maximumStreamDistanceM, 'meters'))
  .unmask(maximumStreamDistanceM)
  .rename('distance_to_stream_m');

var drainageScore = ee.Image(1)
  .subtract(distanceToStream.divide(maximumStreamDistanceM))
  .clamp(0, 1)
  .rename('drainage_score');

var drainageSummaryStats = distanceToStream.reduceRegion({
  reducer: ee.Reducer.min()
    .combine({ reducer2: ee.Reducer.mean(), sharedInputs: true })
    .combine({ reducer2: ee.Reducer.max(), sharedInputs: true }),
  geometry: aoi,
  scale: 90,
  maxPixels: 1e13,
  bestEffort: true,
  tileScale: 4
});

// ---------------- LAND COVER ----------------
var landCover = ee.ImageCollection('ESA/WorldCover/v200')
  .first()
  .select('Map')
  .clip(aoi);

// Standard WorldCover v200 class names, used for legend and stats labels.
var worldCoverClassNames = {
  10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland',
  50: 'Built-up', 60: 'Bare / sparse vegetation', 70: 'Snow and ice',
  80: 'Permanent water bodies', 90: 'Herbaceous wetland',
  95: 'Mangroves', 100: 'Moss and lichen'
};

// Area (km2) per land-cover class, used to report the dominant class.
var landCoverAreaKm2 = ee.Image.pixelArea().divide(1e6)
  .addBands(landCover)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'lc_class' }),
    geometry: aoi,
    scale: 90,
    maxPixels: 1e13,
    bestEffort: true,
    tileScale: 4
  });

// Relative sensitivity scores per WorldCover class (tune as needed).
var landCoverScore = landCover.remap(
  [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
  [0.20, 0.45, 0.60, 0.70, 0.80, 0.90, 0.30, 0.00, 0.50, 0.35, 0.45],
  0.50
).rename('landcover_score');

// ---------------- VEGETATION ----------------
function maskNdvi(image) {
  var qa = image.select('SummaryQA');
  return image.select('NDVI')
    .multiply(0.0001)
    .updateMask(qa.lte(1))
    .rename('NDVI');
}

var medianNdvi = ee.ImageCollection('MODIS/061/MOD13Q1')
  .filterDate('2018-01-01', '2025-01-01')
  .filter(ee.Filter.calendarRange(4, 10, 'month'))
  .map(maskNdvi)
  .median()
  .clip(aoi);

var vegetationScore = ee.Image(1)
  .subtract(medianNdvi.unitScale(0.1, 0.8).clamp(0, 1))
  .rename('low_vegetation_score');

var ndviSummaryStats = medianNdvi.reduceRegion({
  reducer: ee.Reducer.min()
    .combine({ reducer2: ee.Reducer.mean(), sharedInputs: true })
    .combine({ reducer2: ee.Reducer.max(), sharedInputs: true }),
  geometry: aoi,
  scale: 250,
  maxPixels: 1e13,
  bestEffort: true,
  tileScale: 4
});

// ---------------- WEIGHTED OVERLAY ----------------
var susceptibility = slopeScore.multiply(wSlope)
  .add(rainScore.multiply(wRain))
  .add(drainageScore.multiply(wDrainage))
  .add(landCoverScore.multiply(wLandCover))
  .add(vegetationScore.multiply(wVegetation))
  .rename('landslide_susceptibility_0_1')
  .clip(aoi);

// Classes: 1 very low, 2 low, 3 moderate, 4 high, 5 very high
var susceptibilityClass = susceptibility
  .multiply(5)
  .ceil()
  .clamp(1, 5)
  .rename('landslide_class');

// ---------------- DISPLAY ----------------
Map.addLayer(
  slope,
  { min: 0, max: 60, palette: ['ffffff', 'fdae61', 'a50026'] },
  'Slope',
  false
);

Map.addLayer(
  rainP95,
  { min: 5, max: 60, palette: ['ffffcc', 'fd8d3c', '800026'] },
  'Monsoon daily rainfall P95',
  false
);

Map.addLayer(
  susceptibility,
  { min: 0, max: 1, palette: ['1a9850', 'fee08b', 'f46d43', 'a50026'] },
  'Landslide susceptibility'
);

Map.addLayer(
  susceptibilityClass,
  { min: 1, max: 5, palette: ['1a9850', '91cf60', 'fee08b', 'fc8d59', 'a50026'] },
  'Susceptibility classes',
  false
);

// ---------------- LEGEND (bottom-right) ----------------
// Standard cartographic convention for a classified/choropleth layer:
// discrete colour swatches paired with class labels and, where
// meaningful, the underlying index range each class represents.
// Styled as a bordered card (matches the statistics panel below) —
// standard map-inset presentation for publication figures.
var CARD_BORDER = '1px solid #B0B0B0';
var CARD_RADIUS = '4px';
var CARD_BG = 'rgba(255, 255, 255, 0.95)';

var legendPanel = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '10px 14px',
    backgroundColor: CARD_BG,
    border: CARD_BORDER,
    borderRadius: CARD_RADIUS,
    width: '230px'
  }
});

legendPanel.add(ui.Label('Landslide Susceptibility', {
  fontWeight: 'bold',
  fontSize: '13px',
  margin: '0 0 2px 0',
  color: '1a1a1a'
}));
legendPanel.add(ui.Label('Muzaffarabad Tehsil, AJK', {
  fontSize: '10px',
  color: '666666',
  margin: '0 0 8px 0'
}));
legendPanel.add(ui.Panel({
  style: { height: '1px', backgroundColor: 'D9D9D9', margin: '0 0 8px 0', stretch: 'horizontal' }
}));

var legendClasses = [
  { color: '1a9850', label: 'Very Low', range: '0.00 – 0.20' },
  { color: '91cf60', label: 'Low', range: '0.20 – 0.40' },
  { color: 'fee08b', label: 'Moderate', range: '0.40 – 0.60' },
  { color: 'fc8d59', label: 'High', range: '0.60 – 0.80' },
  { color: 'a50026', label: 'Very High', range: '0.80 – 1.00' }
];

legendClasses.forEach(function (item) {
  var colorBox = ui.Label('', {
    backgroundColor: item.color,
    padding: '7px',
    margin: '2px 8px 2px 0',
    border: '1px solid #444444',
    borderRadius: '2px'
  });
  var labelText = ui.Label(item.label, {
    fontSize: '11px', margin: '2px 0', color: '222222', fontWeight: '500'
  });
  var rangeText = ui.Label(item.range, {
    fontSize: '9.5px', margin: '3px 0 0 0', color: '888888'
  });
  var textStack = ui.Panel({
    widgets: [labelText, rangeText],
    layout: ui.Panel.Layout.Flow('vertical')
  });
  legendPanel.add(ui.Panel({
    widgets: [colorBox, textStack],
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: { margin: '0 0 3px 0' }
  }));
});

legendPanel.add(ui.Panel({
  style: { height: '1px', backgroundColor: 'D9D9D9', margin: '8px 0 6px 0', stretch: 'horizontal' }
}));
legendPanel.add(ui.Label('Method: weighted linear combination', {
  fontSize: '9px', color: '999999', margin: '0 0 0 0'
}));
legendPanel.add(ui.Label('(Ayalew & Yamagishi, 2005)', {
  fontSize: '9px', color: '999999', margin: '0 0 0 0'
}));

Map.add(legendPanel);

// ---------------- STATISTICS ----------------
var susceptibilityStats = susceptibility.reduceRegion({
  reducer: ee.Reducer.mean()
    .combine({ reducer2: ee.Reducer.percentile([50, 90, 95]), sharedInputs: true }),
  geometry: aoi,
  scale: 90,
  maxPixels: 1e13,
  bestEffort: true,
  tileScale: 4
});

print('Muzaffarabad susceptibility statistics (mean, median, p90, p95):', susceptibilityStats);

var classAreaKm2 = ee.Image.pixelArea().divide(1e6)
  .addBands(susceptibilityClass)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'landslide_class' }),
    geometry: aoi,
    scale: 90,
    maxPixels: 1e13,
    bestEffort: true,
    tileScale: 4
  });

print('Area (km2) by susceptibility class (1=very low ... 5=very high):', classAreaKm2);

var aoiAreaKm2 = ee.Number(aoi.area({ maxError: 30 })).divide(1e6);

// ---------------- STATISTICS PANEL ----------------
// One combined server-side dictionary, evaluated once client-side, to
// avoid multiple overlapping async callbacks. Units follow standard
// professional GIS/geomorphology convention:
//   - Elevation: metres (primary, per SRTM native unit) and feet
//     (secondary, for audiences using imperial units)
//   - Slope: degrees (primary geomorphometric unit) and percent rise
//     (secondary, common in engineering-geology/landslide literature)
//   - Precipitation: mm/day (CHIRPS native unit)
//   - Distance to stream: metres
//   - NDVI: unitless index, -1 to 1
//   - Susceptibility index: unitless, 0 to 1
//   - Areas: km^2 and % of AOI
var combinedStats = ee.Dictionary({
  terrain: terrainStats,
  rainfall: rainSummaryStats,
  drainage: drainageSummaryStats,
  ndvi: ndviSummaryStats,
  landCoverArea: landCoverAreaKm2,
  susceptibility: susceptibilityStats,
  classArea: classAreaKm2,
  aoiAreaKm2: aoiAreaKm2
});


var PANEL_HEIGHT_PX = 250;
var PANEL_WIDTH_PX = 250;

var statsPanel = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '10px 14px',
    backgroundColor: CARD_BG,
    border: CARD_BORDER,
    borderRadius: CARD_RADIUS,
    width: PANEL_WIDTH_PX + 'px'
  }
});
statsPanel.add(ui.Label('Loading statistics…', { fontSize: '11px', color: '666666' }));
Map.add(statsPanel);

function statRow(label, value) {
  return ui.Panel({
    widgets: [
      ui.Label(label, { fontSize: '10.5px', color: '444444', margin: '1px 4px 1px 0' }),
      ui.Label(value, { fontSize: '10.5px', fontWeight: 'bold', color: '1a1a1a', margin: '1px 0 1px 0' })
    ],
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: { stretch: 'horizontal' }
  });
}

function sectionHeader(text) {
  return ui.Label(text, {
    fontWeight: '600', fontSize: '11px', margin: '5px 0 3px 0', color: '1a1a1a'
  });
}

function dividerLine() {
  return ui.Panel({
    style: { height: '1px', backgroundColor: 'D9D9D9', margin: '4px 0', stretch: 'horizontal' }
  });
}

function fmt(n, decimals) {
  if (n === null || n === undefined) { return 'n/a'; }
  return Number(n).toFixed(decimals);
}

combinedStats.evaluate(function (s) {
  // --- Build page CONTENT AS PLAIN DATA, not widget instances. ---
  // Earlier versions built ui.Label/ui.Panel widgets once and stored
  // them in page arrays; revisiting a page re-added the SAME widget
  // instances to a new contentPanel, which GEE rejects with "Widgets
  // can only be added to one panel at a time." The fix: pages hold
  // only plain descriptor objects; actual widgets are constructed
  // fresh every time a page is rendered, via buildPageWidgets() below.
  var elevM_min = s.terrain.elevation_m_min;
  var elevM_mean = s.terrain.elevation_m_mean;
  var elevM_max = s.terrain.elevation_m_max;
  var mToFt = 3.28084;

  var slopeMin = s.terrain.slope_deg_min;
  var slopeMean = s.terrain.slope_deg_mean;
  var slopeMax = s.terrain.slope_deg_max;
  var slopePctMean = s.terrain.slope_percent_mean;

  var lcGroups = s.landCoverArea.groups || [];
  lcGroups.sort(function (a, b) { return b.sum - a.sum; });
  var lcTotal = lcGroups.reduce(function (acc, g) { return acc + g.sum; }, 0);

  var classLabels = { 1: 'Very Low', 2: 'Low', 3: 'Moderate', 4: 'High', 5: 'Very High' };
  var classGroups = s.classArea.groups || [];
  classGroups.sort(function (a, b) { return a.landslide_class - b.landslide_class; });
  var classTotal = classGroups.reduce(function (acc, g) { return acc + g.sum; }, 0);

  // Descriptor helpers -- each returns a small plain object, not a widget.
  function d_header(text) { return { type: 'header', text: text }; }
  function d_row(label, value) { return { type: 'row', label: label, value: value }; }
  function d_note(text) { return { type: 'note', text: text }; }
  function d_divider() { return { type: 'divider' }; }

  // Page 1: overview + elevation.
  var page1 = [
    d_header('Area of Interest'),
    d_row('Total area:', fmt(s.aoiAreaKm2, 2) + ' km²'),
    d_divider(),
    d_header('Elevation (SRTM, 30 m)'),
    d_row('Min:', fmt(elevM_min, 0) + ' m (' + fmt(elevM_min * mToFt, 0) + ' ft)'),
    d_row('Mean:', fmt(elevM_mean, 0) + ' m (' + fmt(elevM_mean * mToFt, 0) + ' ft)'),
    d_row('Max:', fmt(elevM_max, 0) + ' m (' + fmt(elevM_max * mToFt, 0) + ' ft)')
  ];

  // Page 2: slope.
  var page2 = [
    d_header('Slope'),
    d_row('Min:', fmt(slopeMin, 1) + '°'),
    d_row('Mean:', fmt(slopeMean, 1) + '° (' + fmt(slopePctMean, 1) + '% rise)'),
    d_row('Max:', fmt(slopeMax, 1) + '°'),
    d_divider(),
    d_note('Slope is a gradient (° or % rise), not a'),
    d_note('linear unit — m/ft apply to elevation only.')
  ];

  // Page 3: rainfall + drainage.
  var page3 = [
    d_header('Monsoon Rainfall P95 (CHIRPS)'),
    d_row('Mean:', fmt(s.rainfall.rain_p95_mm_day_mean, 1) + ' mm/day'),
    d_row('Max:', fmt(s.rainfall.rain_p95_mm_day_max, 1) + ' mm/day'),
    d_divider(),
    d_header('Distance to Stream (MERIT)'),
    d_row('Mean:', fmt(s.drainage.distance_to_stream_m_mean, 0) + ' m'),
    d_row('Max:', fmt(s.drainage.distance_to_stream_m_max, 0) + ' m')
  ];

  // Page 4: NDVI + dominant land cover.
  var page4 = [
    d_header('NDVI (MODIS, unitless)'),
    d_row('Mean:', fmt(s.ndvi.NDVI_mean, 2)),
    d_row('Range:', fmt(s.ndvi.NDVI_min, 2) + ' to ' + fmt(s.ndvi.NDVI_max, 2)),
    d_divider(),
    d_header('Land Cover (ESA WorldCover)')
  ].concat(
    lcGroups.slice(0, 3).map(function (g) {
      var className = worldCoverClassNames[g.lc_class] || ('Class ' + g.lc_class);
      var pct = lcTotal > 0 ? (g.sum / lcTotal * 100) : 0;
      return d_row(className + ':', fmt(pct, 0) + '%');
    })
  );

  // Page 5: susceptibility index summary.
  var page5 = [
    d_header('Susceptibility Index (0–1)'),
    d_row('Mean:', fmt(s.susceptibility.landslide_susceptibility_0_1_mean, 2)),
    d_row('Median:', fmt(s.susceptibility.landslide_susceptibility_0_1_p50, 2)),
    d_row('p90 / p95:', fmt(s.susceptibility.landslide_susceptibility_0_1_p90, 2) + ' / ' + fmt(s.susceptibility.landslide_susceptibility_0_1_p95, 2))
  ];

  // Page 6: area by susceptibility class + methodology note.
  var page6 = [
    d_header('Area by Susceptibility Class')
  ].concat(
    classGroups.map(function (g) {
      var pct = classTotal > 0 ? (g.sum / classTotal * 100) : 0;
      return d_row((classLabels[g.landslide_class] || g.landslide_class) + ':', fmt(g.sum, 1) + ' km² (' + fmt(pct, 0) + '%)');
    })
  ).concat([
    d_divider(),
    d_note('Zonal stats @ 30–5566 m depending on layer;'),
    d_note('bestEffort=true may coarsen scale.')
  ]);

  var statsPages = [page1, page2, page3, page4, page5, page6];
  var currentPageIndex = 0;

  // Turns one page's plain-data descriptors into brand-new widget
  // instances. Called fresh on every render -- nothing here is ever
  // stored and reused across renders.
  function buildPageWidgets(pageData) {
    return pageData.map(function (item) {
      if (item.type === 'header') { return sectionHeader(item.text); }
      if (item.type === 'row') { return statRow(item.label, item.value); }
      if (item.type === 'divider') { return dividerLine(); }
      // 'note'
      return ui.Label(item.text, { fontSize: '9px', color: '999999', margin: '1px 0 0 0' });
    });
  }

  function renderStatsPage(pageIndex) {
    statsPanel.clear();

    // Every widget below is freshly created on each render. Reusing a
    // widget instance across multiple panel.add() calls after
    // statsPanel.clear() triggers "Widgets can only be added to one
    // panel at a time" -- so nothing here is created outside this
    // function and re-added.
    statsPanel.add(ui.Label('AOI & Layer Statistics', {
      fontWeight: 'bold', fontSize: '13px', margin: '0 0 2px 0', color: '1a1a1a'
    }));
    statsPanel.add(ui.Label('Muzaffarabad Tehsil, AJK', {
      fontSize: '10px', color: '666666', margin: '0 0 6px 0'
    }));
    statsPanel.add(dividerLine());

    var contentPanel = ui.Panel({
      style: { height: (PANEL_HEIGHT_PX - 110) + 'px' }
    });
    buildPageWidgets(statsPages[pageIndex]).forEach(function (w) { contentPanel.add(w); });
    statsPanel.add(contentPanel);

    // Previous / Next navigation -- buttons are simpler and more
    // reliable here than a slider, and match the requested control.
    var prevButton = ui.Button({
      label: '< Prev',
      style: { fontSize: '10px', margin: '4px 2px 0 0', stretch: 'horizontal' },
      onClick: function () {
        if (currentPageIndex > 0) {
          currentPageIndex -= 1;
          renderStatsPage(currentPageIndex);
        }
      }
    });
    var nextButton = ui.Button({
      label: 'Next >',
      style: { fontSize: '10px', margin: '4px 0 0 2px', stretch: 'horizontal' },
      onClick: function () {
        if (currentPageIndex < statsPages.length - 1) {
          currentPageIndex += 1;
          renderStatsPage(currentPageIndex);
        }
      }
    });
    prevButton.setDisabled(pageIndex === 0);
    nextButton.setDisabled(pageIndex === statsPages.length - 1);

    var navRow = ui.Panel({
      widgets: [prevButton, nextButton],
      layout: ui.Panel.Layout.Flow('horizontal'),
      style: { margin: '0 0 0 0' }
    });
    statsPanel.add(navRow);

    statsPanel.add(ui.Label('Page ' + (pageIndex + 1) + ' of ' + statsPages.length, {
      fontSize: '9.5px', color: '999999', margin: '4px 0 0 0', textAlign: 'center', stretch: 'horizontal'
    }));
  }

  renderStatsPage(0);
});

// ---------------- EXPORT ----------------
var factors = ee.Image.cat([
  dem.rename('elevation_m'),
  slope,
  rainP95,
  distanceToStream,
  medianNdvi.rename('median_NDVI'),
  landCover.rename('landcover_class'),
  susceptibility,
  susceptibilityClass
]);

Export.image.toDrive({
  image: factors,
  description: 'Muzaffarabad_landslide_susceptibility_and_factors',
  folder: 'GEE_MUZAFFARABAD',
  fileNamePrefix: 'Muzaffarabad_landslide_susceptibility_and_factors',
  region: aoi,
  scale: 90,
  maxPixels: 1e13
});

// Method: weighted linear combination (Ayalew & Yamagishi 2005,
// DOI: 10.1016/j.geomorph.2004.06.010). For serious work, add
// geology/fault proximity, curvature and soil, build a landslide
// inventory, and validate with a fitted model + spatial CV.
