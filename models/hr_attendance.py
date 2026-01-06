# -*- coding: utf-8 -*-
from odoo import models, fields, api
import logging
from math import radians, cos, sin, asin, sqrt

_logger = logging.getLogger(__name__)

def haversine(lat1, lon1, lat2, lon2):
    """Hitung jarak (dalam meter) antara dua koordinat menggunakan rumus Haversine"""
    R = 6371000  # Earth radius in meters
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return R * c

class HrAttendance(models.Model):
    _inherit = 'hr.attendance'

    checkin_office_location_id = fields.Many2one(
        'office.location', string='Office Location (Check-in)', readonly=True)
    checkout_office_location_id = fields.Many2one(
        'office.location', string='Office Location (Check-out)', readonly=True)

    @api.model
    def create(self, vals):
        rec = super(HrAttendance, self).create(vals)
        # Set check-in location on create if latitude/longitude diberikan
        if vals.get('in_latitude') and vals.get('in_longitude'):
            office = rec._get_office_by_coords(vals['in_latitude'], vals['in_longitude'])
            rec.checkin_office_location_id = office.id if office else False
        return rec

    def write(self, vals):
        res = super(HrAttendance, self).write(vals)
        for rec in self:
            # Update check-in location
            if 'in_latitude' in vals or 'in_longitude' in vals:
                lat = vals.get('in_latitude', rec.in_latitude)
                lon = vals.get('in_longitude', rec.in_longitude)
                office = rec._get_office_by_coords(lat, lon)
                rec.checkin_office_location_id = office.id if office else False
            # Update check-out location
            if 'out_latitude' in vals or 'out_longitude' in vals:
                lat = vals.get('out_latitude', rec.out_latitude)
                lon = vals.get('out_longitude', rec.out_longitude)
                office = rec._get_office_by_coords(lat, lon)
                rec.checkout_office_location_id = office.id if office else False
        return res
        
    def _get_office_by_coords(self, lat, lon):
        # Cari office.location via polygon the_geom2 (SRID 3857) dengan toleransi boundary
        if lat is None or lon is None:
            return False
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except Exception:
            return False

        cr = self.env.cr
        try:
            cr.execute(
                """
                SELECT id
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
            """,
            (lon_f, lat_f, lon_f, lat_f),
            )
            row = cr.fetchone()
            if row and row[0]:
                return self.env['office.location'].browse(row[0])
        except Exception as e:
                _logger.warning("Polygon lookup failed: %s", e)
        return False
