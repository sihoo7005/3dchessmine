from django.urls import include, path
from records import views

urlpatterns = [
    path('chessmine/accounts/', include('allauth.urls')),
    path('chessmine/auth/start', views.cross_login_start),
    path('chessmine/auth/bridge', views.cross_login_bridge),
    path('chessmine/api/cross/<str:action>', views.cross_api),
    path('chessmine/', views.service_home),
    path('chessmine/privacy.html', views.privacy_file),
]
