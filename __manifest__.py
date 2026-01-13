# -*- coding: utf-8 -*-
{
    'name': 'HR Attendance Control',
    'summary': 'Check-in/out with polygon-based office validation',
    'version': '18.0.1.1.0',
    'author': 'Adi Pramono, AP Odoo Labs',
    'license': 'OPL-1',
    'category': 'Human Resources',
    'website': 'https://apodoolabs.com/',
    'depends': ['base', 'web', 'hr', 'hr_attendance'],
    'data': [
        'data/action_map_editor.xml',
        'views/office_location_views.xml',
        'views/hr_attendance_views.xml',
        'security/ir.model.access.csv',
        'data/office_location_model.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'hr_attendance_ctrl/static/src/js/geo_cache_patch.js',
            'hr_attendance_ctrl/static/src/js/geom_wkt_map_button.js',
            'hr_attendance_ctrl/static/src/xml/*.xml',
            'hr_attendance_ctrl/static/src/js/inject_office_label.js',
            'hr_attendance_ctrl/static/src/js/attendance_loading_patch.js',
            'hr_attendance_ctrl/static/src/css/attendance_left.css',
            'hr_attendance_ctrl/static/src/js/attendance_left_observer.js',
        ],
    },
    'images': ['static/description/banner.png'],
    'support': 'support@apodoolabs.com',
    'installable': True,
    'application': False,
}