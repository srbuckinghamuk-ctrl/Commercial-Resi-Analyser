"""R17 benchmark library and index datasets (spec Sec 27.6).

`library`      -- normalise/validate an elemental benchmark set import and
                  derive currentised rates for a read (never stored).
`index_import` -- parse and validate `period,value` observations.
`seed`         -- load data/index-datasets/*.json idempotently.
`router`       -- the /benchmark-sets and /index-datasets routes.
"""
