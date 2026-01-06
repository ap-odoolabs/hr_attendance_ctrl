# -*- coding: utf-8 -*-
from odoo import http, fields
from odoo.http import request
import logging
from ..models.hr_attendance import haversine

_logger = logging.getLogger(__name__)

class AttendanceLocationController(http.Controller):
    @http.route('/attendance_ctrl/get_name', type='json', auth='user')
    def get_office_name(self, latitude, longitude):
        # Normalize numeric types for coordinates
        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except Exception:
            latitude = float(latitude or 0)
            longitude = float(longitude or 0)
        """
        Mengembalikan nama office.location yang terdekat,
        atau 'Outside Office' jika tidak ada yang memenuhi radius.
        """
        # Normalize types
        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except Exception:
            latitude = float(latitude or 0)
            longitude = float(longitude or 0)
        cr = request.env.cr
        nama = None
        try:
            cr.execute(
        """
        SELECT name
        FROM office_location
        WHERE the_geom2 IS NOT NULL
          AND ST_IsValid(the_geom2)
          AND (
                ST_Covers(
                    the_geom2,
                    ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 3857)
                )
                OR ST_DWithin(
                    the_geom2,
                    ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 3857),
                    5
                )
          )
        ORDER BY id
        LIMIT 1
        """, (float(longitude), float(latitude), float(longitude), float(latitude)),
            )
            row = cr.fetchone()
            if row:
                nama = row[0]
        except Exception as e:
                _logger.warning("get_name polygon lookup failed: %s", e)
        return {'location': nama or 'Outside Office', 'latitude': latitude, 'longitude': longitude}


class AttendanceLocationMapEditor(http.Controller):
    @http.route('/attendance_ctrl/map_editor', type='http', auth='user')
    def map_editor(self, **kw):
        html = """<!DOCTYPE html>
<html><head>
<meta charset='utf-8'/><meta name='viewport' content='width=device-width, initial-scale=1.0'/>
<title>Polygon Editor</title>
<link rel='stylesheet' href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'/>
<link rel='stylesheet' href='https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css'/>
<style>html,body,#map{height:100%;margin:0}.toolbar{position:absolute;z-index:1000;top:10px;left:10px;background:#fff;padding:6px 8px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.15)}.toolbar button{margin-right:6px}</style>
</head><body>
<div id='map'></div>
<div class='toolbar'>
  <button id='btnUse'>Use Polygon</button>
  <button id='btnClear'>Clear</button>
</div>
<script src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'></script>
<script src='https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js'></script>
<script>(function(){var map=L.map('map').setView([-6.200,106.816],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
var drawnItems=new L.FeatureGroup();map.addLayer(drawnItems);
var drawControl=new L.Control.Draw({draw:{polygon:{allowIntersection:false,showArea:true},marker:false,circle:false,circlemarker:false,polyline:false,rectangle:false},edit:{featureGroup:drawnItems}});
map.addControl(drawControl);
map.on(L.Draw.Event.CREATED,function(e){drawnItems.clearLayers();drawnItems.addLayer(e.layer);});
document.getElementById('btnClear').onclick=function(){drawnItems.clearLayers();};
function polygonToWKT(layer){var latlngs=layer.getLatLngs();var ring=latlngs[0]||[];if(!ring.length)return null;var coords=ring.map(function(ll){return ll.lng.toFixed(7)+' '+ll.lat.toFixed(7)});if(coords[0]!==coords[coords.length-1])coords.push(coords[0]);return 'POLYGON(('+coords.join(', ')+'))';}
document.getElementById('btnUse').onclick=function(){var layer=null;drawnItems.eachLayer(function(l){layer=l;});if(!layer){alert('Draw a polygon first.');return;}var wkt=polygonToWKT(layer);if(!wkt){alert('Failed to build WKT.');return;}window.parent.postMessage({type:'odoo-geom-wkt',wkt:wkt},'*');};
// Accept initial WKT from parent and render it
window.addEventListener('message', function(ev){
  try{
    var data = ev && ev.data;
    if (!data || data.type !== 'odoo-geom-wkt-init' || !data.wkt) return;
    var text = String(data.wkt || '').trim();
    if (!/^POLYGON\s*\(\(/i.test(text)) return;
    var inside = text.replace(/^POLYGON\s*\(\(/i,'').replace(/\)\)\s*$/,'');
    var pts = inside.split(',');
    var coords = [];
    for (var i=0;i<pts.length;i++){
      var p = pts[i].trim().split(/\s+/);
      if (p.length>=2){
        var lon = parseFloat(p[0]), lat = parseFloat(p[1]);
        if (!isNaN(lat) && !isNaN(lon)) coords.push([lat, lon]);
      }
    }
    if (coords.length){
      drawnItems.clearLayers();
      var poly = L.polygon(coords, {weight:2, fillOpacity:0.2});
      drawnItems.addLayer(poly);
      map.fitBounds(poly.getBounds(), {padding:[20,20]});
    }
  }catch(e){ console.error('Init WKT parse error', e); }
});
})();</script>
</body></html>"""
        return html
