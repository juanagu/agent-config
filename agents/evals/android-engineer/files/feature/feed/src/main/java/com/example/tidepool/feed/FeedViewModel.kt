package com.example.tidepool.feed

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onStart

sealed interface FeedUiState {
    data object Loading : FeedUiState
    data class Content(val posts: List<PostItem>) : FeedUiState
    data object Error : FeedUiState
}

data class PostItem(val id: String, val title: String)

@HiltViewModel
class FeedViewModel @Inject constructor(
    private val repository: FeedRepository,
) : ViewModel() {

    private val reload = MutableStateFlow(0)

    val uiState: StateFlow<FeedUiState> = reload
        .flatMapLatest {
            repository.observeFeed()
                .map<List<PostItem>, FeedUiState> { FeedUiState.Content(it) }
                .onStart { emit(FeedUiState.Loading) }
                .catch { emit(FeedUiState.Error) }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FeedUiState.Loading)
}
