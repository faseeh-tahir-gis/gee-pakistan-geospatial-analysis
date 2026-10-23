/*******************************************************************************
 * PUNJAB NIGHT-TIME LIGHT MONITORING DASHBOARD (2021–2025)
 * -----------------------------------------------------------------------------
 * Written by: Faseeh Tahir
 * Platform  : Google Earth Engine (JavaScript API)
 * Dataset   : NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG (VIIRS Monthly Nighttime
 *             Lights, Stray-Light Corrected)
 * Study Area: Punjab Province, Pakistan — District-level boundaries
 *
 * -----------------------------------------------------------------------------
 * OBJECTIVES
 * -----------------------------------------------------------------------------
 * 1. Provide an interactive, district-level view of nighttime light
 *    intensity across Punjab as a proxy indicator of urbanization,
 *    electrification, and economic activity.
 * 2. Allow comparison of light intensity across years (2021–2025) and
 *    across months, for any selected district, without writing new code.
 * 3. Compute and display summary statistics (mean, minimum, maximum,
 *    standard deviation) of radiance for the selected district and time
 *    period.
 * 4. Visualize spatial patterns on an interactive map with an adjustable-
 *    opacity nighttime lights layer and a matching color legend.
 * 5. Allow inspection of individual pixel values by clicking on the map.
 * 6. Support export of the analyzed image (GeoTIFF) and its statistics
 *    (CSV) to Google Drive for offline use or reporting.
 *
 * -----------------------------------------------------------------------------
 * HOW TO USE
 * -----------------------------------------------------------------------------
 * 1. Run the script. The map, statistics, and charts load automatically
 *    for the default selection (Lahore, 2025, January).
 * 2. Use the left-hand Controls panel to change District, Year, or Month.
 *    The map, statistics, and charts update automatically — no button
 *    needs to be pressed after a selection.
 * 3. Use the Opacity slider to adjust how visible the nighttime lights
 *    layer is over the satellite basemap.
 * 4. Click anywhere on the map to read that pixel's coordinates and
 *    radiance value in the Pixel Inspector panel (right side).
 * 5. Use "Refresh" to manually re-render the current selection, or
 *    "Reset to Default" to return to the default district/year/month.
 * 6. Use "Export Image (GeoTIFF)" or "Export Statistics (CSV)" to send
 *    results to Google Drive. Each creates a task — open the "Tasks" tab
 *    (top right of the Code Editor) and click "Run" to start it.
 *
 * -----------------------------------------------------------------------------
 * WHAT TO AVOID
 * -----------------------------------------------------------------------------
 * - Do not edit code outside Section 1 unless you understand the effect;
 *   visualization and behavior are controlled by named variables at the
 *   top of the script for exactly this reason.
 * - Do not remove or rename the asset ID in Section 1 without also
 *   updating DISTRICT_NAME_FIELD to match the new asset's schema.
 * - Do not interpret nighttime light radiance as a direct population or
 *   income figure — it is a proxy indicator and should be interpreted
 *   alongside other data sources.
 * - Do not expect Tehsil (sub-district) level results — the current
 *   asset contains district boundaries only.
 * - Do not close the Tasks tab dialog before an export finishes; large
 *   exports can take a few minutes to complete in Google Drive.
 ******************************************************************************/


/*******************************************************************************
 * SECTION 1: LOAD ASSETS
 * -----------------------------------------------------------------------------
 * Load the district boundary FeatureCollection uploaded by the user.
 ******************************************************************************/

var punjabDistricts = ee.FeatureCollection(
  'projects/internship-503314/assets/Punjab_District'
);

// Property in the asset that holds the district name. Verified (and
// corrected automatically if wrong) against the asset's real schema in
// Section 9 before the dashboard becomes interactive.
var DISTRICT_NAME_FIELD = 'DISTRICT';

// Candidate field names to check, in priority order, if DISTRICT_NAME_FIELD
// does not exist on the asset. Covers common naming conventions used in
// Pakistan administrative boundary shapefiles (GADM, PBS, WFP/OCHA, etc.).
var DISTRICT_FIELD_CANDIDATES = [
  'DISTRICT', 'District', 'district', 'DISTRICT_N', 'District_N',
  'DISTNAME', 'Dist_Name', 'DIST_NAME', 'NAME_2', 'NAME', 'ADM2_EN',
  'admin2Name', 'District_1'
];


/*******************************************************************************
 * SECTION 2: LOAD DATASET
 * -----------------------------------------------------------------------------
 * VIIRS Monthly Nighttime Lights (Stray-Light Corrected Config).
 ******************************************************************************/

var viirsCollection = ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG');
var NIGHT_LIGHT_BAND = 'avg_rad';


/*******************************************************************************
 * SECTION 3: VISUALIZATION PARAMETERS
 * -----------------------------------------------------------------------------
 * Centralized visualization settings — edit here to restyle the whole
 * dashboard (map layer + legend) consistently.
 ******************************************************************************/

var VIS_PARAMS = {
  min: 0,
  max: 40,
  palette: [
    '000000', '1a237e', '1565c0', '00acc1',
    '43a047', 'fdd835', 'fb8c00', 'e53935', 'ffffff'
  ]
};

var LEGEND_LABELS = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];


/*******************************************************************************
 * SECTION 4: GLOBAL STATE & CORE FUNCTIONS
 ******************************************************************************/

var DEFAULTS = {
  district: 'LAHORE',
  year: '2025',
  month: 'January',
  opacity: 1
};

var MONTH_MAP = {
  'January': 1, 'February': 2, 'March': 3, 'April': 4,
  'May': 5, 'June': 6, 'July': 7, 'August': 8,
  'September': 9, 'October': 10, 'November': 11, 'December': 12
};
var MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
var YEAR_LIST = ['2021', '2022', '2023', '2024', '2025'];

// Mutable application state — reflects current dropdown/slider selections.
var state = {
  districtName: DEFAULTS.district,
  year: DEFAULTS.year,
  month: DEFAULTS.month,
  opacity: DEFAULTS.opacity
};

// Caches the actual dropdown-list value used as the default district
// (resolved case-insensitively against real asset values), so the Reset
// button always sets a value that truly exists in the dropdown.
var resolvedDefaultDistrict = DEFAULTS.district;

/**
 * Returns the filtered single-feature collection for the given district
 * name. Matching is case-insensitive and whitespace-trimmed on the
 * pre-computed 'normalized_district_name' field (built in Section 9 once
 * the correct name field has been confirmed).
 * @param {string} districtName
 * @return {ee.FeatureCollection}
 */
function getSelectedDistrictFeatureCollection(districtName) {
  var targetName = ee.String(districtName).trim().toLowerCase();
  return punjabDistricts.filter(
    ee.Filter.eq('normalized_district_name', targetName)
  );
}

/**
 * Throws a clear, descriptive error (with a Console diagnostic listing
 * every district name actually present) if the given FeatureCollection
 * is empty, instead of letting clip()/reduceRegion() fail deep with a
 * cryptic "empty geometry" message.
 * @param {ee.FeatureCollection} districtFC
 * @param {string} districtName
 */
function assertDistrictFound(districtFC, districtName) {
  var count = districtFC.size().getInfo();
  if (count === 0) {
    var availableNames = punjabDistricts
      .aggregate_array('normalized_district_name')
      .distinct()
      .getInfo();
    print('DIAGNOSTIC: No match for "' + districtName + '" (normalized: "' +
      String(districtName).trim().toLowerCase() + '"). Names available: ' +
      JSON.stringify(availableNames));
    throw new Error(
      'No district found matching "' + districtName + '". See the ' +
      'DIAGNOSTIC line in the Console for the exact names available.'
    );
  }
}

/**
 * Builds a filtered, clipped monthly composite image for the given
 * district / year / month selection.
 * @param {string} districtName
 * @param {string} yearStr
 * @param {string} monthName
 * @return {ee.Image}
 */
function buildNightLightImage(districtName, yearStr, monthName) {
  var year = parseInt(yearStr, 10);
  var month = MONTH_MAP[monthName];
  var districtFC = getSelectedDistrictFeatureCollection(districtName);
  assertDistrictFound(districtFC, districtName);
  var districtGeom = districtFC.geometry();

  var filtered = viirsCollection
    .filter(ee.Filter.calendarRange(year, year, 'year'))
    .filter(ee.Filter.calendarRange(month, month, 'month'))
    .select(NIGHT_LIGHT_BAND);

  return filtered.mean().clip(districtGeom);
}

/**
 * Computes mean/min/max/stdDev of the given image over the given geometry.
 * @param {ee.Image} image
 * @param {ee.Geometry} geometry
 * @return {ee.Dictionary}
 */
function computeDistrictStatistics(image, geometry) {
  var combinedReducer = ee.Reducer.mean()
    .combine({reducer2: ee.Reducer.minMax(), sharedInputs: true})
    .combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true});

  return image.reduceRegion({
    reducer: combinedReducer,
    geometry: geometry,
    scale: 500,
    maxPixels: 1e9,
    bestEffort: true
  });
}


/*******************************************************************************
 * SECTION 5: CHART FUNCTIONS
 ******************************************************************************/

/** Chart 1: Mean radiance across all years (2021–2025) for a fixed month. */
function buildYearlyTimeSeriesChart(districtName, monthName) {
  var month = MONTH_MAP[monthName];
  var districtFC = getSelectedDistrictFeatureCollection(districtName);
  assertDistrictFound(districtFC, districtName);
  var districtGeom = districtFC.geometry();

  var yearlyImages = ee.ImageCollection(YEAR_LIST.map(function (yearStr) {
    var year = parseInt(yearStr, 10);
    return viirsCollection
      .filter(ee.Filter.calendarRange(year, year, 'year'))
      .filter(ee.Filter.calendarRange(month, month, 'month'))
      .select(NIGHT_LIGHT_BAND)
      .mean()
      .set('system:time_start', ee.Date.fromYMD(year, month, 1).millis());
  }));

  return ui.Chart.image.series({
    imageCollection: yearlyImages,
    region: districtGeom,
    reducer: ee.Reducer.mean(),
    scale: 500,
    xProperty: 'system:time_start'
  }).setOptions({
    title: 'Yearly Trend — ' + monthName + ' (' + districtName + ')',
    hAxis: {title: 'Year', format: 'yyyy'},
    vAxis: {title: 'Mean Radiance (nW/cm²/sr)'},
    lineWidth: 3,
    pointSize: 6,
    colors: ['fb8c00'],
    legend: {position: 'none'},
    titleTextStyle: {fontSize: 13, bold: true}
  });
}

/** Chart 2: Mean radiance across all months (Jan–Dec) for a fixed year. */
function buildMonthlyComparisonChart(districtName, yearStr) {
  var year = parseInt(yearStr, 10);
  var districtFC = getSelectedDistrictFeatureCollection(districtName);
  assertDistrictFound(districtFC, districtName);
  var districtGeom = districtFC.geometry();

  var monthlyImages = ee.ImageCollection(MONTH_NAMES.map(function (monthName) {
    var month = MONTH_MAP[monthName];
    return viirsCollection
      .filter(ee.Filter.calendarRange(year, year, 'year'))
      .filter(ee.Filter.calendarRange(month, month, 'month'))
      .select(NIGHT_LIGHT_BAND)
      .mean()
      .set('system:time_start', ee.Date.fromYMD(year, month, 1).millis());
  }));

  return ui.Chart.image.series({
    imageCollection: monthlyImages,
    region: districtGeom,
    reducer: ee.Reducer.mean(),
    scale: 500,
    xProperty: 'system:time_start'
  }).setOptions({
    title: 'Monthly Comparison — ' + yearStr + ' (' + districtName + ')',
    hAxis: {title: 'Month', format: 'MMM'},
    vAxis: {title: 'Mean Radiance (nW/cm²/sr)'},
    lineWidth: 3,
    pointSize: 6,
    colors: ['1565c0'],
    legend: {position: 'none'},
    titleTextStyle: {fontSize: 13, bold: true}
  });
}

/** Chart 3: Histogram of radiance pixel values within the selected district. */
function buildHistogramChart(image, geometry, districtName) {
  return ui.Chart.image.histogram({
    image: image,
    region: geometry,
    scale: 500,
    maxPixels: 1e9
  }).setOptions({
    title: 'Radiance Distribution — ' + districtName,
    hAxis: {title: 'Radiance (nW/cm²/sr)'},
    vAxis: {title: 'Pixel Count'},
    colors: ['43a047'],
    legend: {position: 'none'},
    titleTextStyle: {fontSize: 13, bold: true}
  });
}


/*******************************************************************************
 * SECTION 6: STATISTICS DISPLAY
 ******************************************************************************/

function updateStatisticsPanel(districtName, yearStr, monthName, image, geometry) {
  var stats = computeDistrictStatistics(image, geometry);

  statDistrictLabel.setValue('District: ' + districtName);
  statYearLabel.setValue('Year: ' + yearStr);
  statMonthLabel.setValue('Month: ' + monthName);

  stats.evaluate(function (result, evalError) {
    if (evalError || !result) {
      statMeanLabel.setValue('Mean Radiance: N/A');
      statMinLabel.setValue('Minimum Radiance: N/A');
      statMaxLabel.setValue('Maximum Radiance: N/A');
      statStdLabel.setValue('Std. Deviation: N/A');
      return;
    }
    var meanVal = result[NIGHT_LIGHT_BAND + '_mean'];
    var minVal = result[NIGHT_LIGHT_BAND + '_min'];
    var maxVal = result[NIGHT_LIGHT_BAND + '_max'];
    var stdVal = result[NIGHT_LIGHT_BAND + '_stdDev'];

    statMeanLabel.setValue('Mean Radiance: ' + (meanVal !== undefined ? meanVal.toFixed(2) : 'N/A'));
    statMinLabel.setValue('Minimum Radiance: ' + (minVal !== undefined ? minVal.toFixed(2) : 'N/A'));
    statMaxLabel.setValue('Maximum Radiance: ' + (maxVal !== undefined ? maxVal.toFixed(2) : 'N/A'));
    statStdLabel.setValue('Std. Deviation: ' + (stdVal !== undefined ? stdVal.toFixed(2) : 'N/A'));
  });
}


/*******************************************************************************
 * SECTION 7: UI COMPONENTS
 ******************************************************************************/

ui.root.clear();

// ---- 7.1 HEADER -------------------------------------------------------------
var headerPanel = ui.Panel({
  widgets: [
    ui.Label({
      value: 'Punjab Night-Time Light Monitoring Dashboard',
      style: {fontSize: '22px', fontWeight: 'bold', color: 'black', margin: '10px 0px 4px 12px'}
    }),
    ui.Label({
      value: 'District-Level Analysis, 2021–2025 | Source: NOAA VIIRS DNB Monthly (VCMSLCFG)',
      style: {fontSize: '12px', color: 'black', margin: '0px 0px 2px 12px'}
    }),
    ui.Label({
      value: 'Developed by Faseeh Tahir',
      style: {fontSize: '11px', color: '#555555', margin: '0px 0px 10px 12px'}
    })
  ],
  style: {backgroundColor: 'white', stretch: 'horizontal', border: '1px solid #cccccc'}
});

// ---- 7.2 LEFT PANEL (Controls) ----------------------------------------------
var controlsPanel = ui.Panel({
  style: {width: '260px', padding: '12px', backgroundColor: '#f5f5f5'}
});

var controlsTitle = ui.Label({
  value: 'Controls',
  style: {fontSize: '16px', fontWeight: 'bold', margin: '0px 0px 10px 0px'}
});

var districtLabel = ui.Label('District');
var districtSelect = ui.Select({
  items: [],
  placeholder: 'Loading districts...',
  style: {stretch: 'horizontal'}
});

var yearLabel = ui.Label('Year');
var yearSelect = ui.Select({
  items: YEAR_LIST,
  value: DEFAULTS.year,
  style: {stretch: 'horizontal'}
});

var monthLabel = ui.Label('Month');
var monthSelect = ui.Select({
  items: MONTH_NAMES,
  value: DEFAULTS.month,
  style: {stretch: 'horizontal'}
});

var opacityLabel = ui.Label('Layer Opacity');
var opacitySlider = ui.Slider({
  min: 0, max: 1, value: DEFAULTS.opacity, step: 0.05,
  style: {stretch: 'horizontal'}
});

var refreshButton = ui.Button({
  label: 'Refresh',
  style: {stretch: 'horizontal', margin: '10px 4px 4px 0px'}
});
var resetButton = ui.Button({
  label: 'Reset to Default',
  style: {stretch: 'horizontal', margin: '4px 4px 4px 0px'}
});
var exportImageButton = ui.Button({
  label: '⬇ Export Image (GeoTIFF)',
  style: {stretch: 'horizontal', margin: '14px 4px 4px 0px'}
});
var exportStatsButton = ui.Button({
  label: '⬇ Export Statistics (CSV)',
  style: {stretch: 'horizontal', margin: '4px 4px 4px 0px'}
});
var exportStatusLabel = ui.Label({
  value: '',
  style: {fontSize: '11px', color: '#666', margin: '6px 4px 0px 0px'}
});

controlsPanel.add(controlsTitle);
controlsPanel.add(districtLabel);
controlsPanel.add(districtSelect);
controlsPanel.add(yearLabel);
controlsPanel.add(yearSelect);
controlsPanel.add(monthLabel);
controlsPanel.add(monthSelect);
controlsPanel.add(opacityLabel);
controlsPanel.add(opacitySlider);
controlsPanel.add(refreshButton);
controlsPanel.add(resetButton);
controlsPanel.add(exportImageButton);
controlsPanel.add(exportStatsButton);
controlsPanel.add(exportStatusLabel);

// ---- 7.3 CENTER MAP ----------------------------------------------------------
var mainMap = ui.Map();
mainMap.setOptions('SATELLITE');
mainMap.style().set('cursor', 'crosshair');
mainMap.setControlVisibility({layerList: true, zoomControl: true, scaleControl: true});

// ---- 7.4 RIGHT PANEL (Statistics, Legend, Pixel Inspector) ------------------
var rightPanel = ui.Panel({style: {width: '280px', padding: '12px', backgroundColor: '#f5f5f5'}});

var statsTitle = ui.Label({value: 'Statistics', style: {fontSize: '16px', fontWeight: 'bold', margin: '0px 0px 8px 0px'}});
var statDistrictLabel = ui.Label('District: —');
var statYearLabel = ui.Label('Year: —');
var statMonthLabel = ui.Label('Month: —');
var statMeanLabel = ui.Label('Mean Radiance: —');
var statMinLabel = ui.Label('Minimum Radiance: —');
var statMaxLabel = ui.Label('Maximum Radiance: —');
var statStdLabel = ui.Label('Std. Deviation: —');

var statsPanel = ui.Panel({
  widgets: [statsTitle, statDistrictLabel, statYearLabel, statMonthLabel,
    statMeanLabel, statMinLabel, statMaxLabel, statStdLabel],
  style: {margin: '0px 0px 14px 0px', padding: '8px', backgroundColor: 'white', border: '1px solid #ddd'}
});

var legendTitle = ui.Label({
  value: 'Legend — Radiance Intensity',
  style: {fontSize: '14px', fontWeight: 'bold', margin: '0px 0px 8px 0px'}
});

function buildLegendPanel() {
  var panel = ui.Panel({style: {margin: '0px 0px 14px 0px', padding: '8px', backgroundColor: 'white', border: '1px solid #ddd'}});
  panel.add(legendTitle);
  var palette = VIS_PARAMS.palette;
  var sampleIndices = [0, 2, 4, 6, 8];
  for (var i = 0; i < LEGEND_LABELS.length; i++) {
    var colorBox = ui.Label({style: {backgroundColor: '#' + palette[sampleIndices[i]], padding: '8px', margin: '0px 6px 4px 0px'}});
    var description = ui.Label({value: LEGEND_LABELS[i], style: {margin: '4px 0px 0px 0px'}});
    panel.add(ui.Panel({widgets: [colorBox, description], layout: ui.Panel.Layout.flow('horizontal')}));
  }
  return panel;
}
var legendPanel = buildLegendPanel();

var inspectorTitle = ui.Label({value: 'Pixel Inspector', style: {fontSize: '14px', fontWeight: 'bold', margin: '0px 0px 8px 0px'}});
var inspectorInstruction = ui.Label({value: 'Click on the map to inspect a pixel.', style: {fontSize: '11px', color: '#666', margin: '0px 0px 8px 0px'}});
var inspectorLatLabel = ui.Label('Latitude: —');
var inspectorLonLabel = ui.Label('Longitude: —');
var inspectorValueLabel = ui.Label('Night Light Value: —');

var inspectorPanel = ui.Panel({
  widgets: [inspectorTitle, inspectorInstruction, inspectorLatLabel, inspectorLonLabel, inspectorValueLabel],
  style: {padding: '8px', backgroundColor: 'white', border: '1px solid #ddd'}
});

rightPanel.add(statsPanel);
rightPanel.add(legendPanel);
rightPanel.add(inspectorPanel);

// ---- 7.5 BOTTOM PANEL (Charts) ----------------------------------------------
var chart1Panel = ui.Panel({style: {stretch: 'horizontal'}});
var chart2Panel = ui.Panel({style: {stretch: 'horizontal'}});
var chart3Panel = ui.Panel({style: {stretch: 'horizontal'}});

var chartsPanel = ui.Panel({
  widgets: [
    ui.Label({value: 'Charts & Trends', style: {fontSize: '16px', fontWeight: 'bold', margin: '10px 0px 8px 12px'}}),
    ui.Panel({widgets: [chart1Panel, chart2Panel, chart3Panel], layout: ui.Panel.Layout.flow('horizontal'), style: {stretch: 'horizontal'}})
  ],
  style: {height: '320px', backgroundColor: '#f5f5f5', stretch: 'horizontal'}
});

// ---- 7.6 MAIN LAYOUT ---------------------------------------------------------
mainMap.style().set('stretch', 'both');

var middlePanel = ui.Panel({
  widgets: [controlsPanel, mainMap, rightPanel],
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {stretch: 'both'}
});

var rootPanel = ui.Panel({
  widgets: [headerPanel, middlePanel, chartsPanel],
  layout: ui.Panel.Layout.flow('vertical'),
  style: {stretch: 'both'}
});

ui.root.add(rootPanel);


/*******************************************************************************
 * SECTION 8: EVENT HANDLERS & DASHBOARD UPDATE LOGIC
 ******************************************************************************/

var nightLightLayerName = 'Night Light Intensity';
var districtOutlineLayerName = 'District Boundary';

/**
 * Master update function — rebuilds the map layers, statistics, and
 * charts for the current district/year/month/opacity selection.
 */
function refreshDashboard() {
  var districtName = state.districtName;
  var yearStr = state.year;
  var monthName = state.month;
  var opacity = state.opacity;

  try {
    var districtFC = getSelectedDistrictFeatureCollection(districtName);
    assertDistrictFound(districtFC, districtName);
    var districtGeom = districtFC.geometry();
    var nightLightImage = buildNightLightImage(districtName, yearStr, monthName);

    mainMap.layers().reset();

    mainMap.layers().add(ui.Map.Layer(
      punjabDistricts.style({color: 'ffffff88', fillColor: '00000000', width: 1}),
      {}, 'All Punjab Districts'
    ));

    mainMap.layers().add(ui.Map.Layer(
      districtFC.style({color: 'ff5252', fillColor: '00000000', width: 2}),
      {}, districtOutlineLayerName
    ));

    mainMap.layers().add(ui.Map.Layer(nightLightImage, VIS_PARAMS, nightLightLayerName, true, opacity));

    mainMap.centerObject(districtFC, 9);

    updateStatisticsPanel(districtName, yearStr, monthName, nightLightImage, districtGeom);

    chart1Panel.clear();
    chart1Panel.add(buildYearlyTimeSeriesChart(districtName, monthName));

    chart2Panel.clear();
    chart2Panel.add(buildMonthlyComparisonChart(districtName, yearStr));

    chart3Panel.clear();
    chart3Panel.add(buildHistogramChart(nightLightImage, districtGeom, districtName));

  } catch (err) {
    var message = (err && err.message) ? err.message : String(err);
    print('Dashboard update failed: ' + message);

    statDistrictLabel.setValue('District: ' + districtName + ' (error)');
    statYearLabel.setValue('Year: ' + yearStr);
    statMonthLabel.setValue('Month: ' + monthName);
    statMeanLabel.setValue('Mean Radiance: —');
    statMinLabel.setValue('Minimum Radiance: —');
    statMaxLabel.setValue('Maximum Radiance: —');
    statStdLabel.setValue('Error: ' + message);
  }
}

districtSelect.onChange(function (selected) {
  state.districtName = selected;
  refreshDashboard();
});

yearSelect.onChange(function (selected) {
  state.year = selected;
  refreshDashboard();
});

monthSelect.onChange(function (selected) {
  state.month = selected;
  refreshDashboard();
});

opacitySlider.onChange(function (value) {
  state.opacity = value;
  var layer = mainMap.layers().get(2); // index 2 = night light layer
  if (layer) {
    layer.setOpacity(value);
  }
});

refreshButton.onClick(function () {
  refreshDashboard();
});

resetButton.onClick(function () {
  state.districtName = resolvedDefaultDistrict;
  state.year = DEFAULTS.year;
  state.month = DEFAULTS.month;
  state.opacity = DEFAULTS.opacity;

  districtSelect.setValue(resolvedDefaultDistrict, false);
  yearSelect.setValue(DEFAULTS.year, false);
  monthSelect.setValue(DEFAULTS.month, false);
  opacitySlider.setValue(DEFAULTS.opacity, false);

  refreshDashboard();
});

// ---- Export Image button -----------------------------------------------------
exportImageButton.onClick(function () {
  try {
    var districtName = state.districtName;
    var yearStr = state.year;
    var monthName = state.month;

    var districtFC = getSelectedDistrictFeatureCollection(districtName);
    assertDistrictFound(districtFC, districtName);
    var districtGeom = districtFC.geometry();
    var nightLightImage = buildNightLightImage(districtName, yearStr, monthName);

    var safeDistrictLabel = districtName.replace(/[^a-zA-Z0-9]/g, '_');
    var exportName = 'NightLight_' + safeDistrictLabel + '_' + yearStr + '_' + monthName;

    Export.image.toDrive({
      image: nightLightImage,
      description: exportName,
      folder: 'GEE_NightLight_Exports',
      fileNamePrefix: exportName,
      region: districtGeom,
      scale: 500,
      maxPixels: 1e9
    });

    exportStatusLabel.setValue(
      'Image export task "' + exportName + '" created. Open the "Tasks" ' +
      'tab (top right) and click "Run" to start it.'
    );
    print('Export task created: ' + exportName + '. Go to the Tasks tab to run it.');

  } catch (err) {
    var message = (err && err.message) ? err.message : String(err);
    exportStatusLabel.setValue('Export failed: ' + message);
    print('Image export failed: ' + message);
  }
});

// ---- Export Statistics button --------------------------------------------------
exportStatsButton.onClick(function () {
  try {
    var districtName = state.districtName;
    var yearStr = state.year;
    var monthName = state.month;

    var districtFC = getSelectedDistrictFeatureCollection(districtName);
    assertDistrictFound(districtFC, districtName);
    var districtGeom = districtFC.geometry();
    var nightLightImage = buildNightLightImage(districtName, yearStr, monthName);
    var stats = computeDistrictStatistics(nightLightImage, districtGeom);

    var statsFeature = ee.Feature(null, stats)
      .set('district', districtName)
      .set('year', yearStr)
      .set('month', monthName);
    var statsFC = ee.FeatureCollection([statsFeature]);

    var safeDistrictLabel = districtName.replace(/[^a-zA-Z0-9]/g, '_');
    var exportName = 'NightLight_Stats_' + safeDistrictLabel + '_' + yearStr + '_' + monthName;

    Export.table.toDrive({
      collection: statsFC,
      description: exportName,
      folder: 'GEE_NightLight_Exports',
      fileNamePrefix: exportName,
      fileFormat: 'CSV'
    });

    exportStatusLabel.setValue(
      'Statistics export task "' + exportName + '" created. Open the ' +
      '"Tasks" tab (top right) and click "Run" to start it.'
    );
    print('Export task created: ' + exportName + '. Go to the Tasks tab to run it.');

  } catch (err) {
    var message = (err && err.message) ? err.message : String(err);
    exportStatusLabel.setValue('Export failed: ' + message);
    print('Statistics export failed: ' + message);
  }
});

// ---- Pixel Inspector click handler --------------------------------------
mainMap.onClick(function (coords) {
  var point = ee.Geometry.Point([coords.lon, coords.lat]);
  var nightLightImage = buildNightLightImage(state.districtName, state.year, state.month);

  var pixelValue = nightLightImage.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: point,
    scale: 500,
    bestEffort: true
  });

  inspectorLatLabel.setValue('Latitude: ' + coords.lat.toFixed(5));
  inspectorLonLabel.setValue('Longitude: ' + coords.lon.toFixed(5));

  pixelValue.evaluate(function (result, evalError) {
    if (evalError || !result) {
      inspectorValueLabel.setValue('Night Light Value: No data');
      return;
    }
    var val = result[NIGHT_LIGHT_BAND];
    inspectorValueLabel.setValue(
      'Night Light Value: ' + (val !== undefined && val !== null ? val.toFixed(2) : 'No data')
    );
  });
});


/*******************************************************************************
 * SECTION 9: DISTRICT FIELD DETECTION + INITIALIZATION
 * -----------------------------------------------------------------------------
 * Confirms the district-name property on the asset, builds a normalized
 * lookup field, populates the District dropdown, and renders the
 * dashboard for the first time.
 ******************************************************************************/

/**
 * Builds the normalized_district_name field on punjabDistricts using the
 * given field name, tolerating null/missing values on individual features.
 * @param {string} fieldName
 */
function buildNormalizedNameField(fieldName) {
  punjabDistricts = punjabDistricts.map(function (feature) {
    var rawValue = feature.get(fieldName);
    var safeName = ee.String(
      ee.Algorithms.If(
        ee.Algorithms.IsEqual(rawValue, null),
        'UNNAMED_DISTRICT',
        rawValue
      )
    );
    return feature.set('normalized_district_name', safeName.trim().toLowerCase());
  });
}

/**
 * Populates the district dropdown from the (now-normalized) collection
 * and triggers the first dashboard render.
 */
function populateDistrictDropdownAndRender() {
  var namesSorted = punjabDistricts
    .aggregate_array(DISTRICT_NAME_FIELD)
    .distinct()
    .sort();

  namesSorted.evaluate(function (namesList, evalError) {
    if (evalError) {
      print('ERROR: Could not read district names. Details: ' + evalError);
      districtSelect.items().reset(['Error loading districts']);
      return;
    }

    var cleanNames = (namesList || []).filter(function (name) {
      return name !== null && name !== undefined && String(name).trim() !== '';
    });

    if (cleanNames.length === 0) {
      print('ERROR: The field "' + DISTRICT_NAME_FIELD + '" produced no ' +
        'usable district names. Check DISTRICT_NAME_FIELD in Section 1.');
      districtSelect.items().reset(['No districts found']);
      return;
    }

    districtSelect.items().reset(cleanNames);

    // Case-insensitive match against the configured default district.
    var defaultLower = String(DEFAULTS.district).trim().toLowerCase();
    var matchedDefault = null;
    for (var i = 0; i < cleanNames.length; i++) {
      if (String(cleanNames[i]).trim().toLowerCase() === defaultLower) {
        matchedDefault = cleanNames[i];
        break;
      }
    }
    var initialDistrict = matchedDefault !== null ? matchedDefault : cleanNames[0];
    resolvedDefaultDistrict = initialDistrict;

    state.districtName = initialDistrict;
    districtSelect.setValue(initialDistrict, false);

    print('Dashboard ready. District field confirmed: "' + DISTRICT_NAME_FIELD +
      '". Districts loaded: ' + cleanNames.length +
      '. Default selection: "' + initialDistrict + '".');

    refreshDashboard();
  });
}

/**
 * Entry point: prints a schema diagnostic, confirms/corrects
 * DISTRICT_NAME_FIELD against the asset's real property names, builds
 * the normalized name field, then populates the dropdown and renders.
 */
function initializeDashboard() {
  var firstFeature = punjabDistricts.first();

  firstFeature.propertyNames().evaluate(function (propNames, propError) {
    if (propError || !propNames || propNames.length === undefined) {
      print('ERROR: Could not read the asset schema. Verify the asset ID ' +
        'in Section 1 is correct and accessible. Details: ' +
        (propError || 'no properties returned'));
      districtSelect.items().reset(['Asset error — see Console']);
      return;
    }

    print('SCHEMA DIAGNOSTIC — Properties found in Punjab_District asset: ' +
      JSON.stringify(propNames));

    var fieldToUse = null;

    if (propNames.indexOf(DISTRICT_NAME_FIELD) !== -1) {
      fieldToUse = DISTRICT_NAME_FIELD;
    } else {
      for (var i = 0; i < DISTRICT_FIELD_CANDIDATES.length; i++) {
        if (propNames.indexOf(DISTRICT_FIELD_CANDIDATES[i]) !== -1) {
          fieldToUse = DISTRICT_FIELD_CANDIDATES[i];
          break;
        }
      }
    }

    if (!fieldToUse) {
      print('ERROR: None of the expected district-name fields were found. ' +
        'Available properties are listed above. Set DISTRICT_NAME_FIELD ' +
        'in Section 1 to the correct property name from that list, then run again.');
      districtSelect.items().reset(['Set DISTRICT_NAME_FIELD — see Console']);
      return;
    }

    if (fieldToUse !== DISTRICT_NAME_FIELD) {
      print('NOTE: DISTRICT_NAME_FIELD ("' + DISTRICT_NAME_FIELD +
        '") was not found. Using auto-detected field "' + fieldToUse +
        '" instead. Update Section 1 to make this permanent.');
      DISTRICT_NAME_FIELD = fieldToUse;
    }

    buildNormalizedNameField(fieldToUse);
    populateDistrictDropdownAndRender();
  });
}

initializeDashboard();
