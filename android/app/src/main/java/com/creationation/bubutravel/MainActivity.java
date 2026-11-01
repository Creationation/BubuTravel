package com.creationation.bubutravel;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * L'app charge le site deploye (voir capacitor.config.ts). En plus, elle
 * recoit les liens partages depuis les autres applications (TikTok,
 * Instagram, YouTube, Google Maps...) et les ouvre sur /idees?text=...,
 * page qui envoie le lien a l'analyse sans autre manipulation.
 */
public class MainActivity extends BridgeActivity {

    private static final String BASE = "https://bubu-travel.vercel.app";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openShared(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openShared(intent);
    }

    private void openShared(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) return;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        final String url = BASE + "/idees?text=" + Uri.encode(text)
                + (subject != null ? "&title=" + Uri.encode(subject) : "");
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
        }
    }
}
