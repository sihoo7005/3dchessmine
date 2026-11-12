from django.urls import include, path
from records import views

urlpatterns = [
    path('chessmine/accounts/', include('allauth.urls')),
    path('chessmine/api/session', views.session_info),
    path('chessmine/api/records', views.records),
    path('chessmine/api/account/delete', views.delete_account),
    path('chessmine/', views.game_file, {'name': 'index.html'}),
    path('chessmine/<str:name>', views.game_file),
]
