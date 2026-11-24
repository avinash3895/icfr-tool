/* Sample data for the look-and-feel build (step 1).
   Everything lives in memory and resets on reload. Step 2 replaces this with real storage.
   All names are generic placeholders. */
(function () {
  var DEFAULT_COLS = [
    { key: 'riskId', label: 'Risk ID' },
    { key: 'riskDesc', label: 'Risk description' },
    { key: 'controlId', label: 'Control ID' },
    { key: 'controlDesc', label: 'Control description' },
    { key: 'type', label: 'Type' },
    { key: 'nature', label: 'Nature' },
    { key: 'freq', label: 'Frequency' },
    { key: 'owner', label: 'Owner' },
    { key: 'key', label: 'Key' },
    { key: 'assertions', label: 'Assertions' },
    { key: 'attrs', label: 'Testing attributes' }
  ];

  // Ids are UUIDs so rows can be saved to Supabase as they are.
  function uid() { return crypto.randomUUID(); }

  // [riskId, riskDesc, controlId, controlDesc, type, nature, freq, owner, key, assertions, attrs, conclusion, exceptions]
  var CONTROLS = {
    p2p: [
      ['P2P-R1', 'Duplicate invoices are paid twice', 'P2P-C1', 'System blocks duplicate invoice numbers per supplier', 'Preventive', 'Automated', 'Continuous', 'AK', 'Yes', 'Occurrence, Accuracy', ['Config evidence', 'Exception report'], 'Effective', ''],
      ['P2P-R2', 'Payment is made for goods not received', 'P2P-C2', 'Three-way match of order, receipt and invoice before payment', 'Preventive', 'Automated', 'Per invoice', 'SM', 'Yes', 'Occurrence, Completeness', ['Match tolerance config', 'Sample of matches'], 'Exception', 'Exception noted on sample item 14: receipt date after invoice date.'],
      ['P2P-R3', 'Unauthorised changes to supplier bank details', 'P2P-C3', 'Bank detail changes are reviewed and approved by a second person', 'Preventive', 'Manual', 'Per change', 'NJ', 'Yes', 'Occurrence', ['DoA', 'Sign-off'], 'Not tested', ''],
      ['P2P-R4', 'Liabilities are not recorded at period end', 'P2P-C4', 'Month-end review of unmatched receipts and accruals', 'Detective', 'Manual', 'Monthly', 'LT', 'Yes', 'Completeness, Cut-off', ['Review sign-off', 'Accrual listing'], 'Not tested', ''],
      ['P2P-R5', 'Payment run includes unapproved invoices', 'P2P-C5', 'Finance manager approves the payment run before release', 'Preventive', 'Manual', 'Per run', 'RP', 'No', 'Occurrence', ['DoA', 'Sign-off'], 'Effective', '']
    ],
    o2c: [
      ['O2C-R1', 'Sales are made to customers over their credit limit', 'O2C-C1', 'System blocks orders above the approved credit limit', 'Preventive', 'Automated', 'Continuous', 'RP', 'Yes', 'Valuation', ['Config evidence', 'Blocked order report'], 'Effective', ''],
      ['O2C-R2', 'Revenue is recorded in the wrong period', 'O2C-C2', 'Month-end review of shipments near period end against invoices', 'Detective', 'Manual', 'Monthly', 'SM', 'Yes', 'Cut-off', ['Review sign-off', 'Shipment listing'], 'Effective', ''],
      ['O2C-R3', 'Credit notes are issued without approval', 'O2C-C3', 'Credit notes above threshold are approved per the DoA', 'Preventive', 'Manual', 'Per credit note', 'AK', 'Yes', 'Occurrence', ['DoA', 'Sign-off'], 'Not tested', ''],
      ['O2C-R4', 'Receivables are not collectible', 'O2C-C4', 'Quarterly review of aged receivables and provision', 'Detective', 'Manual', 'Quarterly', 'LT', 'No', 'Valuation', ['Ageing report', 'Review sign-off'], 'Not tested', '']
    ],
    r2r: [
      ['R2R-R1', 'Manual journals are posted without review', 'R2R-C1', 'Manual journals above threshold are reviewed before posting', 'Preventive', 'Manual', 'Per journal', 'LT', 'Yes', 'Occurrence, Accuracy', ['DoA', 'Sign-off'], 'Effective', ''],
      ['R2R-R2', 'Balance sheet accounts contain errors', 'R2R-C2', 'Monthly balance sheet reconciliations are prepared and reviewed', 'Detective', 'Manual', 'Monthly', 'SM', 'Yes', 'Existence, Accuracy', ['Reconciliation', 'Review sign-off'], 'Effective', ''],
      ['R2R-R3', 'Intercompany balances do not agree', 'R2R-C3', 'Intercompany balances are matched and differences cleared', 'Detective', 'Manual', 'Monthly', 'NJ', 'Yes', 'Completeness', ['Matching report', 'Review sign-off'], 'Not tested', ''],
      ['R2R-R4', 'Financial statements are misstated', 'R2R-C4', 'Finance head reviews the monthly reporting pack', 'Detective', 'Manual', 'Monthly', 'RP', 'Yes', 'Presentation', ['Review sign-off'], 'Not tested', '']
    ],
    pay: [
      ['PAY-R1', 'Payments are made to people who have left', 'PAY-C1', 'Leavers are removed from payroll before the next run', 'Preventive', 'Manual', 'Per leaver', 'AK', 'Yes', 'Occurrence', ['Leaver form', 'Sign-off'], 'Effective', ''],
      ['PAY-R2', 'Payroll changes are not authorised', 'PAY-C2', 'Payroll changes are approved by the people team lead', 'Preventive', 'Manual', 'Per change', 'SM', 'Yes', 'Occurrence, Accuracy', ['DoA', 'Sign-off'], 'Effective', ''],
      ['PAY-R3', 'Payroll costs are recorded incorrectly', 'PAY-C3', 'Monthly payroll reconciliation to the general ledger', 'Detective', 'Manual', 'Monthly', 'LT', 'No', 'Accuracy', ['Reconciliation', 'Review sign-off'], 'Effective', '']
    ],
    trs: [
      ['TRS-R1', 'Unauthorised bank payments', 'TRS-C1', 'Bank payments need two authorised signatories', 'Preventive', 'Automated', 'Per payment', 'NJ', 'Yes', 'Occurrence', ['Bank mandate', 'Payment log'], 'Effective', ''],
      ['TRS-R2', 'Cash balances are misstated', 'TRS-C2', 'Monthly bank reconciliations are prepared and reviewed', 'Detective', 'Manual', 'Monthly', 'RP', 'Yes', 'Existence', ['Reconciliation', 'Review sign-off'], 'Exception', 'Two reconciliations were reviewed after the deadline.'],
      ['TRS-R3', 'Borrowing terms are breached', 'TRS-C3', 'Quarterly covenant calculation is reviewed', 'Detective', 'Manual', 'Quarterly', 'LT', 'No', 'Presentation', ['Covenant calc', 'Sign-off'], 'Not tested', '']
    ],
    itgc: [
      ['ITGC-R1', 'Users have access they do not need', 'ITGC-C1', 'Quarterly user access review for finance systems', 'Detective', 'Manual', 'Quarterly', 'DV', 'Yes', 'All', ['User listing', 'Review sign-off'], 'Effective', ''],
      ['ITGC-R2', 'Untested changes reach production', 'ITGC-C2', 'Changes are tested and approved before release', 'Preventive', 'Manual', 'Per change', 'DV', 'Yes', 'All', ['Change ticket', 'Sign-off'], 'Effective', ''],
      ['ITGC-R3', 'Leavers keep system access', 'ITGC-C3', 'Access is removed within one day of leaving', 'Preventive', 'Manual', 'Per leaver', 'AK', 'Yes', 'All', ['Leaver listing', 'Access log'], 'Not tested', ''],
      ['ITGC-R4', 'Data is lost and cannot be restored', 'ITGC-C4', 'Daily backups are monitored and failures followed up', 'Detective', 'Automated', 'Daily', 'DV', 'No', 'Completeness', ['Backup log'], 'Not tested', '']
    ]
  };

  var NARRATIVE_STEPS = {
    p2p: ['A requisition is raised and approved by the budget owner.', 'The order is sent to the supplier.', 'The invoice is matched to the order and receipt before payment.'],
    o2c: ['A customer order is checked against the credit limit.', 'Goods are shipped and the invoice is raised.', 'Cash is received and matched to open invoices.'],
    r2r: ['Sub-ledgers are closed and posted to the general ledger.', 'Manual journals are prepared and reviewed.', 'Balance sheet accounts are reconciled and the reporting pack is prepared.'],
    pay: ['Joiner, leaver and change forms are approved.', 'The payroll run is calculated and checked.', 'Payroll is paid and posted to the general ledger.'],
    trs: ['Payments are prepared and authorised in the bank portal.', 'Bank statements are reconciled each month.', 'Borrowing and covenants are monitored.'],
    itgc: ['Access to finance systems is requested and approved.', 'System changes are tested and approved before release.', 'Backups run daily and are monitored.']
  };

  var PROCESSES = [
    { id: 'p2p', code: 'P2P', name: 'Procure to pay', owner: 'SM' },
    { id: 'o2c', code: 'O2C', name: 'Order to cash', owner: 'RP' },
    { id: 'r2r', code: 'R2R', name: 'Record to report', owner: 'LT' },
    { id: 'pay', code: 'PAY', name: 'Payroll', owner: 'AK' },
    { id: 'trs', code: 'TRS', name: 'Treasury', owner: 'NJ' },
    { id: 'itgc', code: 'ITGC', name: 'IT general controls', owner: 'DV' }
  ];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function narrativeHtml(name, steps) {
    var lis = (steps || ['First step.', 'Second step.', 'Third step.']).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<h1>' + esc(name) + '</h1><h2>1. Purpose</h2><p>This narrative describes how the ' + esc(name.toLowerCase()) +
      ' process works and where the key controls sit.</p><h2>2. Process steps</h2><ol>' + lis + '</ol>';
  }

  function defaultProcedure(row) {
    if (row.controlId === 'P2P-C2') {
      return '1. Select a sample of 25 invoices from the population.\n2. Check each invoice was matched to the order and the receipt.\n3. Record any exceptions and follow them up.';
    }
    return '1. Select a sample from the population.\n2. Inspect the evidence for each testing attribute.\n3. Record any exceptions and follow them up.';
  }

  function blankTest(row) {
    return { procedure: defaultProcedure(row), exceptions: '', conclusion: 'Not tested', submitted: false, uploads: {} };
  }

  function build() {
    var db = { processes: [], narratives: {}, rcm: {}, toc: {} };
    PROCESSES.forEach(function (p) {
      db.processes.push({ id: p.id, code: p.code, name: p.name, owner: p.owner, pushed: ['PN', 'RCM', 'TOC'] });
      db.narratives[p.id] = narrativeHtml(p.name, NARRATIVE_STEPS[p.id]);
      var rows = (CONTROLS[p.id] || []).map(function (c) {
        var row = {
          id: uid('ctl'),
          values: { riskId: c[0], riskDesc: c[1], controlId: c[2], controlDesc: c[3], type: c[4], nature: c[5], freq: c[6], owner: c[7], key: c[8], assertions: c[9], attrs: c[10].slice() }
        };
        var t = blankTest(row.values);
        t.conclusion = c[11];
        t.exceptions = c[12];
        db.toc[row.id] = t;
        return row;
      });
      db.rcm[p.id] = { cols: DEFAULT_COLS.map(function (x) { return { key: x.key, label: x.label }; }), rows: rows };
    });
    // A submitted test so the locked state can be seen.
    var first = db.rcm.p2p.rows[0];
    db.toc[first.id].submitted = true;
    db.toc[first.id].uploads = {
      'Config evidence': [{ name: 'duplicate-check-config.pdf', size: '214 KB' }],
      'Exception report': [{ name: 'exception-report-oct.xlsx', size: '38 KB' }]
    };
    return db;
  }

  window.ICFR_DATA = {
    build: build,
    uid: uid,
    esc: esc,
    DEFAULT_COLS: DEFAULT_COLS,
    narrativeHtml: narrativeHtml,
    blankTest: blankTest,
    user: { name: 'Avinash', role: 'Admin' },
    period: 'FY2026 · Q4',
    // Sample "My actions" on the dashboard. Step 2 derives these from assignments.
    actions: [
      { title: 'Upload evidence', ref: 'P2P-C4', pill: 'a', label: 'Due 28 Nov' },
      { title: 'Review test', ref: 'O2C-C2', pill: 'b', label: 'Review' },
      { title: 'Reopened', ref: 'TRS-C2', pill: 'r', label: 'Returned' }
    ],
    overdue: 2,
    gaps: {
      p2p: [
        { gap: 'Payment run approval has no control', risk: 'Payment run is released without review', control: 'Payment run is reviewed against the approved invoice list before release' },
        { gap: 'New suppliers are set up without checks', risk: 'Payments are made to suppliers that do not exist', control: 'New supplier set-up is checked and approved by procurement' }
      ]
    },
    genericGaps: function (name) {
      return [
        { gap: 'Step 1 of the ' + name.toLowerCase() + ' narrative has no control', risk: 'Errors at the first step are not caught', control: 'Review and approval of step 1 before it is processed' },
        { gap: 'Month-end review is described but not in the RCM', risk: 'Period-end balances are misstated', control: 'Month-end review of ' + name.toLowerCase() + ' balances with sign-off' }
      ];
    }
  };
})();
