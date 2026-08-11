package com.adkerala.gpstest;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GpsTestPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
