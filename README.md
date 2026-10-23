# GEE Pakistan Geospatial Analysis

Three Google Earth Engine (JavaScript API) projects for Pakistan, covering night-time lights, drought, and landslide susceptibility.

**Author:** Faseeh Tahir

| Project | Study area | What it does |
|---|---|---|
| [`punjab-nightlight-dashboard`](punjab-nightlight-dashboard/) | Punjab districts | Interactive VIIRS night-light dashboard (2021–2025) with district/year/month selectors, stats, charts, pixel inspector, and GeoTIFF/CSV export |
| [`gujranwala-drought-mapping`](gujranwala-drought-mapping/) | Gujranwala District | Maps meteorological, agricultural, vegetation and hydrological-proxy drought plus a combined severity index |
| [`muzaffarabad-landslide-susceptibility`](muzaffarabad-landslide-susceptibility/) | Muzaffarabad Tehsil, AJK | Weighted-overlay landslide susceptibility with legend, paged statistics panel, and export |

## Repository structure

```
gee-pakistan-geospatial-analysis/
├── README.md
├── LICENSE
├── .gitignore
├── punjab-nightlight-dashboard/
│   └── punjab_nightlight_dashboard.js
├── gujranwala-drought-mapping/
│   └── gujranwala_drought_types.js
└── muzaffarabad-landslide-susceptibility/
    └── muzaffarabad_landslide_susceptibility.js
```

## Datasets used

| Dataset | Earth Engine ID | Used in |
|---|---|---|
| VIIRS Monthly Night Lights (stray-light corrected) | `NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG` | Night-light |
| CHIRPS v3 daily rainfall | `UCSB-CHC/CHIRPS/V3/DAILY_RNL` | Drought, Landslide |
| MODIS NDVI (Terra/Aqua) | `MODIS/061/MOD13Q1`, `MYD13Q1` | Drought, Landslide |
| MODIS LST (Terra/Aqua) | `MODIS/061/MOD11A2`, `MYD11A2` | Drought |
| SMAP soil moisture | `NASA/SMAP/SPL3SMP_E/005`, `/006` | Drought |
| TerraClimate | `IDAHO_EPSCOR/TERRACLIMATE` | Drought |
| ESA WorldCover v200 | `ESA/WorldCover/v200` | Drought, Landslide |
| SRTM 30 m DEM | `USGS/SRTMGL1_003` | Landslide |
| MERIT Hydro | `MERIT/Hydro/v1_0_1` | Landslide |

## How to run

1. Sign in to the [Earth Engine Code Editor](https://code.earthengine.google.com/).
2. Create a new script and paste in the `.js` file of the project you want.
3. **Update the boundary asset IDs** (see below) so they point to assets you own or can read.
4. Click **Run**.
5. For exports, open the **Tasks** tab and click **Run** on each task.

### Boundary assets

The scripts load boundary FeatureCollections from the author's Earth Engine project:

| Script | Asset ID in code |
|---|---|
| Night-light dashboard | `projects/internship-503314/assets/Punjab_District` |
| Drought mapping | `projects/internship-503314/assets/Gujranwala_D` |
| Landslide susceptibility | `projects/internship-503314/assets/Muzaffarabad` |

These are private by default. Either ask the owner for Reader access, or upload your own shapefiles (e.g. from GADM or PBS) and replace the IDs. For the night-light dashboard, also set `DISTRICT_NAME_FIELD` to match your shapefile's district-name column (the script attempts to auto-detect common names).

## Method notes and limitations

- **Night lights** are a proxy for urbanisation and economic activity, not a direct measure of population or income. Only district-level results are supported.
- **Drought**: the rainfall, runoff and soil-moisture layers are standardised anomalies (z-scores), not formal SPI. The combined index weights (35/30/20/15) are provisional. The hydrological layer is a runoff proxy, not observed river flow or groundwater. Validate against PMD stations, canal and crop records.
- **Landslide**: weighted linear combination (Ayalew & Yamagishi, 2005). Weights are provisional and uncalibrated. Geology, faults, curvature and soil are not included. Calibrate and validate against a landslide inventory before any serious use.

## References

- Kogan, F.N. (1995). Vegetation Condition Index, Temperature Condition Index and drought.
- McKee, T.B., Doesken, N.J. and Kleist, J. (1993). Standardized Precipitation Index.
- Chan et al. (2016). SMAP soil-moisture product assessment.
- Abatzoglou et al. (2018). TerraClimate.
- Ayalew, L. and Yamagishi, H. (2005). The application of GIS-based logistic regression for landslide susceptibility mapping in the Kakuda-Yahiko Mountains, Central Japan. *Geomorphology*. DOI: 10.1016/j.geomorph.2004.06.010

## License

MIT, see [LICENSE](LICENSE).
