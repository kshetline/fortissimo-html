import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { SharedModule } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { FieldsetModule } from 'primeng/fieldset';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { MenuModule } from 'primeng/menu';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TooltipModule } from 'primeng/tooltip';

import { AppComponent } from './app.component';
import { PreferencesService } from './preferences.service';
import { ShrinkWrapComponent } from './widgets/shrink-wrap/shrink-wrap.component';

@NgModule({
  declarations: [
    AppComponent,
    ShrinkWrapComponent,
  ],
  imports: [
    BrowserAnimationsModule,
    BrowserModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    DropdownModule,
    FieldsetModule,
    FormsModule,
    HttpClientModule,
    InputTextareaModule,
    InputTextModule,
    MenuModule,
    RadioButtonModule,
    SharedModule,
    TooltipModule,
  ],
  providers: [PreferencesService],
  bootstrap: [AppComponent]
})
export class AppModule { }
