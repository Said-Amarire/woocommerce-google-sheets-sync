var consumerKey = 'YOUR_WOOCOMMERCE_CONSUMER_KEY';
var consumerSecret = 'YOUR_WOOCOMMERCE_CONSUMER_SECRET';
var siteUrl = 'https://your-woocommerce-site.com/';
var sheetName = 'WooCommerce Orders';
var SECRET_TOKEN = 'YOUR_CUSTOM_SECRET_SECURITY_TOKEN'; 

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Order Management & COD')
    .addItem('Fetch Latest Orders Manually', 'fetchOrders')
    .addToUi();
  createOrdersSheet();
}

function handleSheetEdit(e) {
  if (!e) return;
  var range = e.range;
  var sheet = range.getSheet();
  
  if (sheet.getName() !== sheetName) return;

  var headerMap = getHeaderMap(sheet);
  var statusColIndex = headerMap['Status'];
  var idColIndex = headerMap['Order ID'];
  if (!statusColIndex || !idColIndex) return;

  var startRow = range.getRow();
  var numRows = range.getNumRows();
  var startCol = range.getColumn();
  var numCols = range.getNumColumns();

  if (startCol <= statusColIndex && statusColIndex <= (startCol + numCols - 1)) {
    var idValues = sheet.getRange(startRow, idColIndex, numRows, 1).getValues();
    var statusValues = sheet.getRange(startRow, statusColIndex, numRows, 1).getValues();
    var batchUpdates = [];

    for (var i = 0; i < numRows; i++) {
      var currentRow = startRow + i;
      if (currentRow === 1) continue;

      var orderId = idValues[i][0];
      var newStatus = String(statusValues[i][0]).trim();

      if (orderId && newStatus) {
        batchUpdates.push({
          id: orderId,
          status: newStatus
        });
      }
    }

    if (batchUpdates.length > 0) {
      sendBatchStatusToWooCommerce(batchUpdates);
    }
  }
}

function sendBatchStatusToWooCommerce(updates) {
  var options = {
    'method': 'post',
    'muteHttpExceptions': true,
    'headers': {
      'Authorization': 'Basic ' + Utilities.base64Encode(consumerKey + ':' + consumerSecret),
      'Content-Type': 'application/json'
    },
    'payload': JSON.stringify({ 'update': updates })
  };

  var url = siteUrl + 'wp-json/wc/v3/orders/batch';
  try {
    UrlFetchApp.fetch(url, options);
  } catch (err) {
    Logger.log(err.message);
  }
}

function createOrdersSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    var headers = ['Order ID', 'Date', 'Status', 'Customer Name', 'Phone', 'Email', 'Address', 'Products', 'Variations', 'Total', 'Customer IP', 'Shipping Company', 'Delivery Notes'];
    sheet.appendRow(headers);
    var headerMap = getHeaderMap(sheet);
    if (headerMap['Status']) {
      var statusRange = sheet.getRange(2, headerMap['Status'], sheet.getMaxRows());
      var statusRule = SpreadsheetApp.newDataValidation().requireValueInList(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'], true).build();
      statusRange.setDataValidation(statusRule);
    }
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#1e272e').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1); 
  }
}

function getHeaderMap(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) map[headers[i].toString().trim()] = i + 1;
  }
  return map;
}

function writeOrderRow(sheet, rowNum, order, headerMap) {
  var lastCol = sheet.getLastColumn();
  var rowData = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  
  function filterValue(oldVal, newVal) {
    if (newVal === undefined || newVal === null || newVal === '') {
      return oldVal; 
    }
    return newVal;
  }
  
  if (headerMap['Order ID']) rowData[headerMap['Order ID'] - 1] = filterValue(rowData[headerMap['Order ID'] - 1], order.id);
  if (headerMap['Date']) rowData[headerMap['Date'] - 1] = filterValue(rowData[headerMap['Date'] - 1], order.date);
  if (headerMap['Status']) rowData[headerMap['Status'] - 1] = filterValue(rowData[headerMap['Status'] - 1], order.status);
  if (headerMap['Customer Name']) rowData[headerMap['Customer Name'] - 1] = filterValue(rowData[headerMap['Customer Name'] - 1], order.name);
  if (headerMap['Phone']) rowData[headerMap['Phone'] - 1] = filterValue(rowData[headerMap['Phone'] - 1], order.phone);
  if (headerMap['Email']) rowData[headerMap['Email'] - 1] = filterValue(rowData[headerMap['Email'] - 1], order.email);
  if (headerMap['Address']) rowData[headerMap['Address'] - 1] = filterValue(rowData[headerMap['Address'] - 1], order.address);
  if (headerMap['Products']) rowData[headerMap['Products'] - 1] = filterValue(rowData[headerMap['Products'] - 1], order.products);
  if (headerMap['Variations']) rowData[headerMap['Variations'] - 1] = filterValue(rowData[headerMap['Variations'] - 1], order.variations); 
  if (headerMap['Total']) rowData[headerMap['Total'] - 1] = filterValue(rowData[headerMap['Total'] - 1], order.total);
  if (headerMap['Customer IP']) rowData[headerMap['Customer IP'] - 1] = filterValue(rowData[headerMap['Customer IP'] - 1], order.ip); 
  
  sheet.getRange(rowNum, 1, 1, lastCol).setValues([rowData]);
  sheet.getRange(rowNum, headerMap['Phone']).setNumberFormat('@');
  sheet.getRange(rowNum, headerMap['Date']).setNumberFormat('yyyy-MM-dd HH:mm:ss');
  sheet.getRange(rowNum, headerMap['Total']).setNumberFormat('@');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); 
    if (!e.parameter.token || e.parameter.token !== SECRET_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({status: 'unauthorized'})).setMimeType(ContentService.MimeType.JSON);
    }
    
    var order = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    var headerMap = getHeaderMap(sheet);
    
    var orderRow = findOrderRow(sheet, order.id, headerMap);
    if (orderRow) {
      writeOrderRow(sheet, orderRow, order, headerMap);
    } else {
      sheet.insertRowBefore(2);
      writeOrderRow(sheet, 2, order, headerMap);
    }
    return ContentService.createTextOutput('Success').setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    return ContentService.createTextOutput('Error: ' + error.message).setMimeType(ContentService.MimeType.TEXT);
  } finally {
    lock.releaseLock(); 
  }
}

function findOrderRow(sheet, orderId, headerMap) {
  var idColIndex = headerMap['Order ID'];
  if (!idColIndex) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var idValues = sheet.getRange(1, idColIndex, lastRow, 1).getValues();
  for (var i = 1; i < idValues.length; i++) {
    if (idValues[i][0] == orderId) return i + 1;
  }
  return null;
}

function fetchOrders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var headerMap = getHeaderMap(sheet);
  var options = {
    'method': 'get',
    'muteHttpExceptions': true,
    'headers': { 'Authorization': 'Basic ' + Utilities.base64Encode(consumerKey + ':' + consumerSecret) }
  };

  var url = siteUrl + 'wp-json/wc/v3/orders?per_page=30&page=1';
  var response = UrlFetchApp.fetch(url, options);
  var orders = JSON.parse(response.getContentText());

  if (orders && orders.length > 0) {
    orders.forEach(function(order) {
      var products_summary = [];
      var variations_summary = [];

      order.line_items.forEach(function(item) {
        var cleanName = item.name.replace(/<\/?[^>]+(>|$)/g, "").trim();
        products_summary.push(cleanName + " (x" + item.quantity + ")");

        var item_meta = [];
        var uniqueMetaCheck = {}; 

        if (item.meta_data && item.meta_data.length > 0) {
          item.meta_data.forEach(function(m) {
            var keyStr = String(m.key || '').trim();
            
            if (keyStr === '_wapf_meta' && m.value && typeof m.value === 'object') {
              for (var subKey in m.value) {
                var subField = m.value[subKey];
                if (subField && subField.label && subField.value) {
                  var l = String(subField.label).trim();
                  var v = String(subField.value).trim();
                  if (l && v && !uniqueMetaCheck[l]) {
                    item_meta.push(l + ": " + v);
                    uniqueMetaCheck[l] = true;
                  }
                }
              }
              return;
            }

            if (keyStr.indexOf('_') === 0) return;

            var label = String(m.display_key ? m.display_key : m.key).trim();
            var value = String(m.display_value ? m.display_value : m.value).trim();

            if (label && value && value !== '[object Object]' && !uniqueMetaCheck[label]) {
              item_meta.push(label + ": " + value);
              uniqueMetaCheck[label] = true;
            }
          });
        }

        if (item_meta.length > 0) {
          if (order.line_items.length > 1) {
            variations_summary.push("[" + cleanName + "]:\n" + item_meta.join("\n"));
          } else {
            variations_summary.push(item_meta.join("\n"));
          }
        }
      });

      var mappedOrder = {
        id: order.id,
        date: order.date_created ? order.date_created.replace('T', ' ') : '',
        status: order.status,
        name: order.billing.first_name + ' ' + order.billing.last_name,
        phone: order.billing.phone,
        email: order.billing.email,
        address: [order.billing.address_1, order.billing.city].filter(Boolean).join(', '),
        products: products_summary.join(', '),
        variations: variations_summary.join("\n\n"),
        total: order.total + ' ' + order.currency,
        ip: order.customer_ip_address || ''
      };

      var orderRow = findOrderRow(sheet, order.id, headerMap);
      writeOrderRow(sheet, orderRow ? orderRow : sheet.getLastRow() + 1, mappedOrder, headerMap);
    });
    SpreadsheetApp.getUi().alert('Done: Fields updated perfectly based on RAW JSON data!');
  }
}
