*! snapshot.do — golden-master snapshot harness for the stata-sam-refactor skill
*! Requires Stata 16+ (frames, ustrregex).
*!
*! Captures every final output of a Stata pipeline into a snapshot directory so
*! that `compare.do` can diff the ORIGINAL run against a REFACTORED run.
*!
*! Invariants captured:
*!   datasets  -> datasignature (value checksum) + schema (describe + label list)
*!   estimates -> ereturn list + every e() matrix in %21x (bit-exact) + e(cmdline)
*!   graphs    -> declared command string + datasignature of declared plot vars
*!   tables    -> file text with auto timestamp/header lines stripped
*!
*! Typical use:
*!   do snapshot.do
*!   snap_open, dir("snap_orig")
*!   <run pipeline; at each output call a snap_* program>
*!       ... build analysis data ...
*!       snap_dataset, name("analysis")
*!       regress y x z
*!       snap_estimate, name("main_reg")
*!       twoway scatter y x
*!       snap_graph, name("fig1") cmd("twoway scatter y x") vars(x y)
*!       esttab using "tables/tab1.tex", replace
*!       snap_table using "tables/tab1.tex", name("tab1")
*!   snap_close
*!
*! Then snapshot the refactored pipeline into dir("snap_new") and run:
*!   do compare.do snap_orig snap_new

version 16
set more off
capture program drop snap_open _snap_capture_ds snap_dataset snap_estimate snap_graph _snap_is_timestamp snap_table snap_auto snap_close

* ----------------------------- snap_open -----------------------------
program define snap_open
    syntax, dir(string)
    capture mkdir `"`dir'"'
    file open oh using `"`dir'/manifest.txt"', write replace
    file write oh "stata_version `c(stata_version)'" _n
    file write oh "flavor `c(flavor)'" _n
    file write oh "os `c(os)' `c(osdtl)'" _n
    file write oh "machine `c(machine_type)'" _n
    file write oh "bit `c(bit)'" _n
    file write oh "varabbrev `c(varabbrev)'" _n
    file write oh "type `c(type)'" _n
    local sseed = substr("`c(seed)'",1,40)
    file write oh "seed `sseed'" _n
    file write oh "run_date `c(current_date)' `c(current_time)'" _n
    file close oh
    global SNAP_DIR `"`dir'"'
    di as txt "snapshot dir: `dir'"
end

* ---------- internal: capture datasignature + schema of current data ----------
* Writes to `outfile'. Strips the "Contains data from <path>" header line so that
* path modernization (a GREEN refactor) does not create false positives.
program define _snap_capture_ds
    args outfile

    * Normalize variable (column) order so that reordering variable
    * construction is output-neutral. Work on a throwaway frame copy; the live
    * data's variable order and sort order are left untouched. Observation order
    * is deliberately NOT normalized — row order can change sort/by:-dependent
    * results, and that is a difference we WANT the harness to catch.
    tempname work
    frame copy `c(frame)' `work'
    tempfile sch
    frame `work' {
        quietly order _all, alphabetic
        quietly datasignature
        local dsig "`r(datasignature)'"
        if `"`dsig'"'=="" local dsig "`r(datasig)'"
        local N = _N
        local K = c(k)

        * schema + value-label contents, captured via a named text log
        quietly log using `"`sch'"', text replace name(schlog)
        set more off
        describe, fullnames
        local usedvl ""
        foreach v of varlist _all {
            local vl : val label `v'
            if `"`vl'"'!="" local usedvl : list usedvl | vl
        }
        foreach vlname of local usedvl {
            label list `vlname'
        }
        quietly log close schlog
    }
    frame drop `work'

    file open oh using `"`outfile'"', write replace
    file write oh "DATASIGNATURE `dsig'" _n
    file write oh "N `N'" _n
    file write oh "K `K'" _n

    * append schema log, dropping the path-bearing "Contains data from" header
    file open ah using `"`sch'"', read
    file read ah line
    while r(eof)==0 {
        if strpos(`"`line'"',"Contains data from")!=1 {
            local clean = ustrregexra(`"`line'"', " [0-9]{1,2} [A-Za-z]{3} [0-9]{4}( [0-9]{1,2}:[0-9]{2})?", "")
            file write oh `"`clean'"' _n
        }
        file read ah line
    }
    file close ah
    file close oh
end

* ----------------------------- snap_dataset -----------------------------
* Snapshots data in memory (default) or a saved .dta via using().
program define snap_dataset
    syntax [using/] , name(string)
    local name : subinstr local name " " "_", all
    local outfile `"$SNAP_DIR/dataset_`name'.txt"'
    if `"`using'"'!="" {
        tempname frm
        frame create `frm'
        frame `frm' {
            use `"`using'"', clear
            _snap_capture_ds `"`outfile'"'
        }
        frame drop `frm'
    }
    else {
        _snap_capture_ds `"`outfile'"'
    }
    di as txt "  snap_dataset -> `name'"
end

* ----------------------------- snap_estimate -----------------------------
* Captures e() from the last estimation: ereturn list (cmdline, scalars, macros,
* matrix display) PLUS every e() matrix dumped in %21x (bit-exact). The e(cmdline)
* line is the THE-WALL backstop: any change to the estimation command or its
* options shows up here and fails compare.do.
program define snap_estimate
    syntax , name(string)
    local name : subinstr local name " " "_", all
    if `"`e(cmd)'"'=="" {
        di as error "snap_estimate: no e() results in memory"
        exit 111
    }

    * ereturn list -> text log
    tempfile er
    quietly log using `"`er'"', text replace name(erlog)
    ereturn list
    quietly log close erlog
    copy `"`er'"' `"$SNAP_DIR/estimate_`name'_ereturn.txt"', replace

    * every e() matrix in %21x, via di-to-log (guaranteed bit-exact)
    local mats : e(matrices)
    foreach m of local mats {
        matrix M = e(`m')
        local cn : colnames M
        local nc : word count `cn'
        local rn : rownames M
        local nr : word count `rn'
        tempfile mf
        quietly log using `"`mf'"', text replace name(mlog)
        di "MATRIX `m' `nr' x `nc'"
        forval i = 1/`nr' {
            forval j = 1/`nc' {
                di %21x (M[`i',`j']) _continue
            }
            di
        }
        quietly log close mlog
        copy `"`mf'"' `"$SNAP_DIR/estimate_`name'_mat_`m'_21x.txt"', replace
    }

    * every e() scalar in %21x (bit-exact). ereturn list above captures scalars
    * only at display precision (~8 figs); this catches a sub-display-precision
    * drift (e.g. e(rmse)/e(F) perturbed by upstream float-summation order) that
    * the e(b)/e(V) matrices might not surface on their own.
    local scals : e(scalars)
    tempfile sf
    quietly log using `"`sf'"', text replace name(slog)
    foreach s of local scals {
        di "`s' " %21x (e(`s'))
    }
    quietly log close slog
    copy `"`sf'"' `"$SNAP_DIR/estimate_`name'_scalars_21x.txt"', replace

    di as txt "  snap_estimate -> `name'"
end

* ----------------------------- snap_graph -----------------------------
* Content-equivalence: captures the declared command string AND the datasignature
* of the declared plot variables. Exported .gph/.png/.pdf carry timestamps and are
* NOT compared at the byte level.
program define snap_graph
    syntax , name(string) [cmd(string) vars(varlist)]
    local name : subinstr local name " " "_", all
    file open oh using `"$SNAP_DIR/graph_`name'_cmd.txt"', write replace
    file write oh `"CMD `cmd'"' _n
    file close oh
    if `"`vars'"'!="" {
        preserve
        keep `vars'
        _snap_capture_ds `"$SNAP_DIR/graph_`name'_data.txt"'
        restore
    }
    di as txt "  snap_graph -> `name'"
end

* -------- internal: is a table line a pure timestamp/header line? --------
program define _snap_is_timestamp, rclass
    args line
    local s = ustrregexrf(`"`line'"', "^\s*[*%#]?\s*", "")
    if ustrregexm(`"`s'"', "^[0-9]{4}-[0-9]{2}-[0-9]{2}([, ]+[0-9]{1,2}:[0-9]{2}:[0-9]{2})?\s*$") {
        return local is 1
        exit
    }
    if ustrregexm(`"`s'"', "^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}([, ]+[0-9]{1,2}:[0-9]{2}:[0-9]{2})?\s*$") {
        return local is 1
        exit
    }
    if ustrregexm(`"`s'"', "^[A-Za-z]{3} [0-9]{1,2}, [0-9]{4}([, ]+[0-9]{1,2}:[0-9]{2}:[0-9]{2})?\s*$") {
        return local is 1
        exit
    }
    return local is 0
end

* ----------------------------- snap_table -----------------------------
* Copies an exported table (.tex/.txt/.csv/.rtf/...) into the snapshot with
* auto-generated timestamp/header lines stripped, so two runs of the same table
* compare equal. Extend _snap_is_timestamp if your table writer uses another date
* format.
*
* ignore(regex)  drop any line matching this regular expression before
*                comparison, in addition to the auto-detected pure-date lines.
*                Use it for run-to-run boilerplate the date stripper does not
*                catch — an embedded timestamp, a tempfile path, a "Generated
*                by ..." stamp. The pattern is a Stata ustrregexm() expression;
*                combine several with alternation, e.g.
*                    ignore("^% Generated|^% Source")
*                It only suppresses lines you name, so it cannot hide a change
*                in the table's actual numbers.
program define snap_table
    syntax using/ , name(string) [ ignore(string) ]
    local name : subinstr local name " " "_", all
    file open ih using `"`using'"', read
    file open oh using `"$SNAP_DIR/table_`name'.txt"', write replace
    file read ih line
    while r(eof)==0 {
        local drop 0
        _snap_is_timestamp `"`line'"'
        if `r(is)'==1 local drop 1
        if `drop'==0 & `"`ignore'"'!="" {
            if ustrregexm(`"`line'"', `"`ignore'"') local drop 1
        }
        if `drop'==0 file write oh `"`line'"' _n
        file read ih line
    }
    file close ih
    file close oh
    di as txt "  snap_table -> `name'"
end

* ----------------------------- snap_auto -----------------------------
* Convenience: snapshot the data in memory and, if present, the current e().
program define snap_auto
    syntax , name(string)
    snap_dataset, name("`name'_data")
    if `"`e(cmd)'"'!="" snap_estimate, name("`name'_est")
end

* ----------------------------- snap_close -----------------------------
program define snap_close
    di as txt "snapshot complete: $SNAP_DIR"
    macro drop SNAP_DIR
end
