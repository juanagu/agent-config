package com.example.tidepool.feed

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.tidepool.R
import com.example.tidepool.designsystem.Spacing

@Composable
fun FeedRoute(viewModel: FeedViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    FeedScreen(uiState = uiState)
}

@Composable
fun FeedScreen(uiState: FeedUiState, modifier: Modifier = Modifier) {
    Column(modifier.padding(Spacing.md)) {
        when (uiState) {
            FeedUiState.Loading -> Text("...")
            is FeedUiState.Content -> uiState.posts.forEach { Text(it.title) }
            FeedUiState.Error -> Column(Modifier.padding(top = 16.dp)) {
                Text(stringResource(R.string.feed_error_message))
            }
        }
    }
}
