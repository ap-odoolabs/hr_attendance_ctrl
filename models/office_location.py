from odoo import models, fields, api, _
from odoo.exceptions import UserError   # <-- tambahkan ini
import logging

_logger = logging.getLogger(__name__)

class OfficeLocation(models.Model):
    _name = "office.location"
    _description = "Office Location (Geometry without GeoEngine)"

    name = fields.Char("Location Name", required=True)

    # UI helper fields
    geom_wkt = fields.Text("Polygon WKT", help="Enter WKT Polygon (lon lat).")
    geom_srid = fields.Selection(
        [('4326', 'EPSG:4326 (WGS84)'), ('3857', 'EPSG:3857 (Web Mercator)')],
        string="SRID",
        default='4326'
    )

    # Computed info (dibaca dari kolom geometry yang dibuat via SQL init)
    geom_valid = fields.Boolean("Valid Geometry", compute="_compute_geom_info", store=False)
    area_m2 = fields.Float("Area (m²)", compute="_compute_geom_info", digits=(16, 2), store=False)
    centroid_lat = fields.Float("Centroid Lat (WGS84)", compute="_compute_geom_info", digits=(10, 6), store=False)
    centroid_lon = fields.Float("Centroid Lon (WGS84)", compute="_compute_geom_info", digits=(10, 6), store=False)

    # ===== Utilities =====
    def _has_postgis(self):
        """Return True jika extension postgis terpasang di DB."""
        self.env.cr.execute("SELECT 1 FROM pg_extension WHERE extname = 'postgis'")
        return self.env.cr.fetchone() is not None

    def _has_geom_column(self):
        """Return True jika kolom the_geom2 sudah ada di table."""
        self.env.cr.execute("""
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'office_location' AND column_name = 'the_geom2'
        """)
        return self.env.cr.fetchone() is not None

    # ===== Install/Upgrade hook =====
    def init(self):
        """
        Called when installing/upgrading a module.
        - Do not create EXTENSION (avoid privilege error).
        - If PostGIS already exists, create geometry & index columns if they don't exist already.
        """
        cr = self.env.cr

        if not self._has_postgis():
            # Display a message box & stop the install/upgrade process
            raise UserError(_(
                "[office.location] PostGIS is not active yet.\n\n"
                "First activate it in this database:\n"
                "  CREATE EXTENSION postgis;\n\n"
                "Once active, repeat the Install/Upgrade module process."
            ))

        # Buat kolom geometry jika belum ada
        cr.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name='office_location' AND column_name='the_geom2'
                ) THEN
                    ALTER TABLE office_location
                    ADD COLUMN the_geom2 geometry(Polygon,3857);
                END IF;
            END$$;
        """)

        # Buat index GIST (idempotent)
        cr.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relname = 'idx_office_location_geom2' AND n.nspname = 'public'
                ) THEN
                    CREATE INDEX idx_office_location_geom2
                    ON office_location
                    USING GIST (the_geom2);
                END IF;
            END$$;
        """)

    # ===== Create/Write hooks =====
    @api.model
    def create(self, vals):
        recs = super().create(vals)
        # Apply geometry if PostGIS and column exist
        if self._has_postgis() and self._has_geom_column():
            try:
                recs.action_apply_geometry()
            except Exception as e:
                _logger.exception("[office.location] Gagal menerapkan geometri saat pembuatan: %s", e)
        else:
            _logger.info("[office.location] Skip apply geometry (PostGIS/columns not ready yet).")
        return recs

    def write(self, vals):
        res = super().write(vals)
        if any(k in vals for k in ('geom_wkt', 'geom_srid')):
            if self._has_postgis() and self._has_geom_column():
                try:
                    self.action_apply_geometry()
                except Exception as e:
                    _logger.exception("[office.location] Failed to apply geometry when writing: %s", e)
            else:
                _logger.info("[office.location] Skip apply geometry (PostGIS/columns not ready yet).")
        return res

    # ===== Actions =====
    def action_apply_geometry(self):
        """
        Masukkan geom_wkt + geom_srid ke kolom the_geom2.
        - Jika SRID 4326: set SRID 4326 lalu transform ke 3857.
        - Jika SRID 3857: set SRID 3857 langsung.
        - Gunakan ST_MakeValid agar polygon valid.
        """
        if not (self._has_postgis() and self._has_geom_column()):
            return True

        cr = self.env.cr
        for rec in self:
            if not rec.geom_wkt or not rec.geom_wkt.strip():
                cr.execute("UPDATE office_location SET the_geom2 = NULL WHERE id = %s", (rec.id,))
                continue

            if rec.geom_srid == '4326':
                cr.execute(
                    """
                    UPDATE office_location
                    SET the_geom2 = ST_MakeValid(
                        ST_Transform(
                            ST_SetSRID(ST_GeomFromText(%s), 4326),
                            3857
                        )
                    )
                    WHERE id = %s
                    """,
                    (rec.geom_wkt, rec.id)
                )
            else:
                cr.execute(
                    """
                    UPDATE office_location
                    SET the_geom2 = ST_MakeValid(
                        ST_SetSRID(ST_GeomFromText(%s), 3857)
                    )
                    WHERE id = %s
                    """,
                    (rec.geom_wkt, rec.id)
                )
        # trigger recompute
        self._compute_geom_info()
        return True

    # ===== Computes =====
    @api.depends('geom_wkt', 'geom_srid', 'name')
    def _compute_geom_info(self):
        cr = self.env.cr
        postgis_ok = self._has_postgis() and self._has_geom_column()
        for rec in self:
            if not postgis_ok:
                rec.geom_valid = False
                rec.area_m2 = 0.0
                rec.centroid_lat = 0.0
                rec.centroid_lon = 0.0
                continue
            try:
                cr.execute(
                    """
                    SELECT
                        COALESCE(ST_IsValid(the_geom2), FALSE) AS valid,
                        COALESCE(ST_Area(the_geom2), 0) AS area_m2,
                        COALESCE(ST_Y(ST_Transform(ST_Centroid(the_geom2), 4326)), 0) AS lat,
                        COALESCE(ST_X(ST_Transform(ST_Centroid(the_geom2), 4326)), 0) AS lon
                    FROM office_location
                    WHERE id = %s
                    """,
                    (rec.id,)
                )
                row = cr.fetchone() or (False, 0, 0, 0)
                rec.geom_valid = bool(row[0])
                rec.area_m2 = float(row[1] or 0)
                rec.centroid_lat = float(row[2] or 0)
                rec.centroid_lon = float(row[3] or 0)
            except Exception:
                rec.geom_valid = False
                rec.area_m2 = 0.0
                rec.centroid_lat = 0.0
                rec.centroid_lon = 0.0
