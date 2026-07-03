*! compare.do — diff two snapshot directories produced by snapshot.do
*! Requires Stata 16+.
*!
*! Usage:  do compare.do <orig_dir> <new_dir>
*!
*! Reports PASS/FAIL per output file, flags missing/extra outputs, warns on
*! Stata-version drift between the two runs, sets global COMPARE_OK (1/0), and
*! exits with rc 4500 if any output differs.

version 16
set more off
capture program drop _snap_manifest_version _snap_cmpfile

local orig `1'
local new  `2'
if `"`orig'"'=="" | `"`new'"'=="" {
    di as error "usage: do compare.do <orig_dir> <new_dir>"
    exit 198
}

* ---------- manifest: warn on Stata-version drift ----------
program define _snap_manifest_version, rclass
    args path
    capture confirm file `"`path'/manifest.txt"'
    if _rc {
        return local v "(no manifest)"
        exit
    }
    file open mh using `"`path'/manifest.txt"', read
    file read mh line
    while r(eof)==0 {
        if strpos(`"`line'"',"stata_version")==1 {
            return local v `"`line'"'
            continue, break
        }
        file read mh line
    }
    file close mh
end

_snap_manifest_version `"`orig'"'
local vo `"`r(v)'"'
_snap_manifest_version `"`new'"'
local vn `"`r(v)'"'
if `"`vo'"'!=`"`vn'"' {
    di as error "WARNING: Stata version differs across runs."
    di as error "  original:    `vo'"
    di as error "  refactored:  `vn'"
    di as error "  A version difference can change command defaults and explain"
    di as error "  estimate mismatches. Re-run both under the same Stata version."
}

* ---------- file comparison helper ----------
program define _snap_cmpfile, rclass
    args fa fb
    file open a using `"`fa'"', read
    file open b using `"`fb'"', read
    file read a la
    local ea = r(eof)
    file read b lb
    local eb = r(eof)
    local ln 0
    local ok 1
    local msg ""
    while (`ea'==0 | `eb'==0) {
        local ++ln
        if `ea'==1 & `eb'==0 {
            local ok 0
            local msg "REFACTORED has extra line(s) from line `ln'"
            continue, break
        }
        if `ea'==0 & `eb'==1 {
            local ok 0
            local msg "ORIGINAL has extra line(s) from line `ln'"
            continue, break
        }
        if `"`la'"'!=`"`lb'"' {
            local ok 0
            local msg "mismatch at line `ln'"
            continue, break
        }
        file read a la
        local ea = r(eof)
        file read b lb
        local eb = r(eof)
    }
    capture file close a
    capture file close b
    return local ok `ok'
    return local msg `"`msg'"'
end

* ---------- enumerate and compare ----------
local fa : dir `"`orig'"' files "*"
local fb : dir `"`new'"' files "*"
local allf : list fa | fb

if `"`allf'"'=="" {
    di as error "WARNING: no snapshot files found in either directory."
}

local nfail 0
local nmiss 0
local npass 0

foreach f of local allf {
    if `"`f'"'=="manifest.txt" continue
    local inA : list f in fa
    local inB : list f in fb
    if `inA'==0 | `inB'==0 {
        local where = cond(`inA'==0, "absent in ORIGINAL", "absent in REFACTORED")
        di as error "MISSING `f' — `where'"
        local ++nmiss
        local ++nfail
        continue
    }
    _snap_cmpfile `"`orig'/`f'"' `"`new'/`f'"'
    if `r(ok)'==1 {
        di as result "PASS   `f'"
        local ++npass
    }
    else {
        di as error "FAIL   `f' — `r(msg)'"
        local ++nfail
    }
}

global COMPARE_OK `=cond(`nfail'==0,1,0)'

di _n as txt "——— summary ———"
di as txt "passed:   `npass'"
di as txt "failed:   `=`nfail'-`nmiss''"
di as txt "missing:  `nmiss'"

if `nfail'>0 {
    di as error "REFACTOR FAILED: one or more outputs differ."
    exit 4500
}
di as result "ALL OUTPUTS IDENTICAL."
