<?php

add_action('woocommerce_checkout_order_processed', 'dynamic_sheets_realtime_sync', 99, 1);
add_action('woocommerce_order_status_changed', 'dynamic_sheets_realtime_sync', 99, 1);
add_action('woocommerce_update_order', 'dynamic_sheets_realtime_sync', 99, 1);

function dynamic_sheets_realtime_sync($order_id) {
    if (defined('REST_REQUEST') && REST_REQUEST) {
        if (isset($_SERVER['HTTP_USER_AGENT']) && strpos($_SERVER['HTTP_USER_AGENT'], 'Google-Apps-Script') !== false) {
            return;
        }
    }

    wp_cache_delete($order_id, 'orders');
    clean_post_cache($order_id);

    $order = wc_get_order($order_id);
    if (!$order) {
        return;
    }

    if ($order->get_status() === 'checkout-draft') {
        return;
    }

    $google_web_app_url = 'https://script.google.com/macros/s/YOUR_GOOGLE_WEB_APP_ID_HERE/exec';
    $my_private_token   = 'YOUR_CUSTOM_SECRET_SECURITY_TOKEN_HERE'; 
    
    $target_url = add_query_arg('token', $my_private_token, $google_web_app_url);

    $customer_ip = $order->get_customer_ip_address();
    if (empty($customer_ip) || $customer_ip === '127.0.0.1' || $customer_ip === '::1') {
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            $customer_ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
        } elseif (!empty($_SERVER['HTTP_CLIENT_IP'])) {
            $customer_ip = $_SERVER['HTTP_CLIENT_IP'];
        } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $customer_ip = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0];
        } else {
            $customer_ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
        }
        
        if (!empty($customer_ip)) {
            $order->set_customer_ip_address($customer_ip);
            $order->save();
        }
    }

    $products_summary = array();
    $variations_summary = array();

    foreach ($order->get_items() as $item) {
        $product_name = wp_strip_all_tags($item->get_name());
        $products_summary[] = $product_name . ' (x' . $item->get_quantity() . ')';
        
        $item_meta = array();
        
        foreach ($item->get_meta_data() as $meta) {
            $key = $meta->key;
            $value = $meta->value;
            
            if ($key === '_wapf_meta' && (is_array($value) || is_object($value))) {
                foreach ((array)$value as $sub_field) {
                    if (isset($sub_field['label']) && isset($sub_field['value'])) {
                        $l = trim(wp_strip_all_tags($sub_field['label']));
                        $v = trim(wp_strip_all_tags($sub_field['value']));
                        if (!empty($l) && !empty($v)) {
                            $item_meta[$l] = $l . ': ' . $v;
                        }
                    }
                }
                continue;
            }
            
            if (strpos($key, '_') === 0 || strpos(strtolower($key), 'attribute_') !== false) {
                continue;
            }
            
            $label = wc_attribute_label($key, $item->get_product());
            $display_value = $value;
            
            if (taxonomy_exists($key)) {
                $term = get_term_by('slug', $value, $key);
                if ($term && !is_wp_error($term)) {
                    $display_value = $term->name;
                }
            }
            
            $l = trim(wp_strip_all_tags($label));
            $v = trim(wp_strip_all_tags($display_value));
            
            if (!empty($l) && !empty($v)) {
                if (strpos(strtolower($l), 'attribute_') === false && strpos(strtolower($l), 'pa_') === false) {
                    $item_meta[$l] = $l . ': ' . $v;
                }
            }
        }
        
        if ($item->get_variation_id() > 0) {
            $product_var = $item->get_product();
            if ($product_var && is_callable(array($product_var, 'get_variation_attributes'))) {
                $var_attributes = $product_var->get_variation_attributes();
                foreach ($var_attributes as $attr_name => $attr_val) {
                    $clean_attr_name = str_replace('attribute_', '', $attr_name);
                    $label = wc_attribute_label($clean_attr_name, $product_var);
                    $display_value = $attr_val;
                    
                    if (taxonomy_exists($clean_attr_name)) {
                        $term = get_term_by('slug', $attr_val, $clean_attr_name);
                        if ($term && !is_wp_error($term)) {
                            $display_value = $term->name;
                        }
                    }
                    
                    $l = trim(wp_strip_all_tags($label));
                    $v = trim(wp_strip_all_tags($display_value));
                    
                    if (!empty($l) && !empty($v)) {
                        if (strpos(strtolower($l), 'attribute_') === false && strpos(strtolower($l), 'pa_') === false) {
                            if (!isset($item_meta[$l])) {
                                $item_meta[$l] = $l . ': ' . $v;
                            }
                        }
                    }
                }
            }
        }
        
        if (!empty($item_meta)) {
            if (count($order->get_items()) > 1) {
                $variations_summary[] = '[' . $product_name . "]:\n" . implode("\n", $item_meta);
            } else {
                $variations_summary[] = implode("\n", $item_meta);
            }
        }
    }

    $payload_data = array(
        'id'         => $order->get_id(),
        'date'       => $order->get_date_created() ? $order->get_date_created()->date('Y-m-d H:i:s') : date('Y-m-d H:i:s'),
        'status'     => $order->get_status(),
        'name'       => $order->get_billing_first_name() . ' ' . $order->get_billing_last_name(),
        'phone'      => $order->get_billing_phone(),
        'email'      => $order->get_billing_email(),
        'address'    => implode(', ', array_filter(array($order->get_billing_address_1(), $order->get_billing_city()))),
        'products'   => implode(', ', $products_summary),
        'variations' => implode("\n\n", $variations_summary), 
        'total'      => $order->get_total() . ' ' . $order->get_currency(),
        'ip'         => $customer_ip 
    );

    $log_file = WP_CONTENT_DIR . '/uploads/wc_sheet_sync_log.txt';
    $log_message = sprintf(
        "[%s] Order ID: %d | Status: %s | IP Sent: %s | Variations Sent: %s\n",
        date('Y-m-d H:i:s'),
        $payload_data['id'],
        $payload_data['status'],
        $payload_data['ip'] ? $payload_data['ip'] : 'EMPTY',
        $payload_data['variations'] ? str_replace("\n", " ", $payload_data['variations']) : 'EMPTY'
    );
    file_put_contents($log_file, $log_message, FILE_APPEND);

    $connection_settings = array(
        'body'        => wp_json_encode($payload_data),
        'headers'     => array('Content-Type' => 'application/json'),
        'timeout'     => 15,
        'blocking'    => true
    );

    wp_remote_post($target_url, $connection_settings);
}
